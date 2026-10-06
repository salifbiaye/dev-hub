import json
import re

from .connect import mongo_db_name, _db_connections
from .schema import fetch_schema

_SKIP = object()


def _coerce_value(raw, family, nullable, has_default):
    if raw is None or raw == "":
        if has_default:
            return _SKIP, None
        if nullable:
            return None, None
        return None, "champ requis"
    if family == "int":
        try:
            return int(raw), None
        except (TypeError, ValueError):
            return None, "nombre entier attendu"
    if family == "float":
        try:
            return float(raw), None
        except (TypeError, ValueError):
            return None, "nombre attendu"
    if family == "bool":
        if isinstance(raw, bool):
            return raw, None
        s = str(raw).strip().lower()
        if s in ("true", "1", "yes", "on"):
            return True, None
        if s in ("false", "0", "no", "off"):
            return False, None
        return None, "booléen attendu (true/false)"
    if family == "json":
        try:
            json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            return None, "JSON invalide"
        return raw, None
    return raw, None


def _sql_literal(value, family):
    if value is None:
        return "NULL"
    if family in ("int", "float"):
        return str(value)
    if family == "bool":
        return "TRUE" if str(value).strip().lower() in ("true", "1", "t") else "FALSE"
    return "'" + str(value).replace("'", "''") + "'"


_FILTER_OPS = {"=": "=", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=", "like": "LIKE"}
_MONGO_FILTER_OPS = {"=": "$eq", "!=": "$ne", ">": "$gt", "<": "$lt", ">=": "$gte", "<=": "$lte"}


def _build_where(engine, valid_columns, filters, placeholder):
    clauses, params = [], []
    quote = "`" if engine == "mysql" else '"'
    for f in filters or []:
        col = f.get("column")
        op = f.get("op")
        if col not in valid_columns:
            continue
        qcol = f"{quote}{col}{quote}"
        if op == "is null":
            clauses.append(f"{qcol} IS NULL")
        elif op == "is not null":
            clauses.append(f"{qcol} IS NOT NULL")
        elif op == "like" and op in _FILTER_OPS:
            clauses.append(f"{qcol} LIKE {placeholder}")
            params.append(f"%{f.get('value', '')}%")
        elif op in _FILTER_OPS:
            clauses.append(f"{qcol} {_FILTER_OPS[op]} {placeholder}")
            params.append(f.get("value", ""))
    if not clauses:
        return "", params
    return " WHERE " + " AND ".join(clauses), params


def _build_search_clause(engine, schema_columns, search, placeholder):
    # OR'd across every text-ish column — searchable columns are limited to
    # families that can be safely LIKE-matched, so a numeric column with
    # e.g. "42" doesn't silently need a cast that could error on some engines.
    if not (search or "").strip():
        return "", []
    quote = "`" if engine == "mysql" else '"'
    like_op = "ILIKE" if engine == "postgres" else "LIKE"
    # postgres/mysql have no ~~*/LIKE operator directly on uuid/json — those
    # need an explicit cast to text first, or the query fails outright
    # (confirmed: "operator does not exist: uuid ~~* unknown").
    cast_type = "CHAR" if engine == "mysql" else "TEXT"
    cols = [c for c in schema_columns if c["family"] in ("text", "uuid", "json")]
    if not cols:
        return "", []
    clauses = []
    for c in cols:
        qcol = f"{quote}{c['name']}{quote}"
        expr = f"CAST({qcol} AS {cast_type})" if c["family"] in ("uuid", "json") else qcol
        clauses.append(f"{expr} {like_op} {placeholder}")
    params = [f"%{search}%"] * len(cols)
    return " (" + " OR ".join(clauses) + ")", params


def _build_mongo_filter(filters):
    result = {}
    for f in filters or []:
        col = f.get("column")
        op = f.get("op")
        if not col:
            continue
        if op == "is null":
            result[col] = None
        elif op == "is not null":
            result[col] = {"$ne": None}
        elif op == "like":
            result[col] = {"$regex": re.escape(f.get("value", "")), "$options": "i"}
        elif op in _MONGO_FILTER_OPS:
            result[col] = {_MONGO_FILTER_OPS[op]: f.get("value", "")}
    return result


class DatabaseCrudMixin:
    def db_read_table(self, path, table, limit=50, offset=0, filters=None, search=None, order_by=None, order_dir="asc"):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or ""):
            return {"error": "Nom de table invalide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                db = conn[mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                coll = db[table]
                mongo_filter = _build_mongo_filter(filters)
                if (search or "").strip():
                    # $text needs a text index we can't guarantee exists — fall back
                    # to per-field regex on whatever string keys the sample already has.
                    sample = coll.find_one(mongo_filter) or {}
                    str_keys = [k for k, v in sample.items() if isinstance(v, str)]
                    if str_keys:
                        regex_clause = {"$or": [{k: {"$regex": re.escape(search), "$options": "i"}} for k in str_keys]}
                        mongo_filter = {"$and": [mongo_filter, regex_clause]}
                cursor = coll.find(mongo_filter)
                if order_by:
                    cursor = cursor.sort(order_by, -1 if order_dir == "desc" else 1)
                docs = list(cursor.skip(offset).limit(limit))
                columns, types = [], {}
                for doc in docs:
                    for key, value in doc.items():
                        if key not in types:
                            columns.append(key)
                            types[key] = type(value).__name__
                rows = [[None if doc.get(c) is None else str(doc.get(c)) for c in columns] for doc in docs]
                return {
                    "columns": [
                        {"name": c, "type": types[c], "family": "text", "is_pk": c == "_id", "fk": None}
                        for c in columns
                    ],
                    "rows": rows,
                    "total": coll.count_documents(mongo_filter),
                    "pk_column": "_id",
                }

            schema_columns, pk_column = fetch_schema(conn, engine, table)
            valid_columns = {c["name"] for c in schema_columns}
            by_name = {c["name"]: c for c in schema_columns}
            quote = "`" if engine == "mysql" else '"'
            quoted = f"{quote}{table}{quote}"
            placeholder = "?" if engine == "sqlite" else "%s"
            where_sql, where_params = _build_where(engine, valid_columns, filters, placeholder)
            search_sql, search_params = _build_search_clause(engine, schema_columns, search, placeholder)
            if search_sql:
                where_sql = f" WHERE {search_sql}" if not where_sql else f"{where_sql} AND{search_sql}"
                where_params = where_params + search_params

            order_sql = ""
            if order_by in valid_columns:
                direction = "DESC" if order_dir == "desc" else "ASC"
                order_sql = f" ORDER BY {quote}{order_by}{quote} {direction}"

            cur = conn.cursor()
            cur.execute(
                f"SELECT * FROM {quoted}{where_sql}{order_sql} LIMIT {placeholder} OFFSET {placeholder}",
                (*where_params, limit, offset),
            )
            names = [d[0] for d in cur.description]
            rows = [[None if v is None else str(v) for v in row] for row in cur.fetchall()]
            cur.execute(f"SELECT COUNT(*) FROM {quoted}{where_sql}", tuple(where_params))
            total = cur.fetchone()[0]
            cur.close()
            return {
                "columns": [
                    {
                        "name": n,
                        "type": by_name.get(n, {}).get("type", ""),
                        "family": by_name.get(n, {}).get("family", "text"),
                        "is_pk": by_name.get(n, {}).get("is_pk", False),
                        "fk": by_name.get(n, {}).get("fk"),
                    }
                    for n in names
                ],
                "rows": rows,
                "total": total,
                "pk_column": pk_column,
            }
        except Exception as e:
            return {"error": str(e)}
        finally:
            conn.close()

    def db_delete_rows(self, path, table, pk_values):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or ""):
            return {"error": "Nom de table invalide"}
        if not pk_values:
            return {"error": "Aucune ligne sélectionnée"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                from bson import ObjectId

                ids = []
                for v in pk_values:
                    try:
                        ids.append(ObjectId(v))
                    except Exception:
                        ids.append(v)
                db = conn[mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                result = db[table].delete_many({"_id": {"$in": ids}})
                return {"ok": True, "deleted": result.deleted_count}

            _schema_columns, pk_column = fetch_schema(conn, engine, table)
            if not pk_column:
                return {"error": "Pas de clé primaire unique sur cette table — utilise l'éditeur SQL pour supprimer."}
            quote = "`" if engine == "mysql" else '"'
            quoted_table = f"{quote}{table}{quote}"
            quoted_pk = f"{quote}{pk_column}{quote}"
            placeholder = "?" if engine == "sqlite" else "%s"
            placeholders = ", ".join([placeholder] * len(pk_values))
            cur = conn.cursor()
            cur.execute(f"DELETE FROM {quoted_table} WHERE {quoted_pk} IN ({placeholders})", tuple(pk_values))
            deleted = cur.rowcount
            conn.commit()
            cur.close()
            return {"ok": True, "deleted": deleted}
        except Exception as e:
            conn.rollback()
            return {"error": str(e)}
        finally:
            conn.close()

    def db_insert_row(self, path, table, values):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or ""):
            return {"error": "Nom de table invalide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                db = conn[mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                doc = {k: v for k, v in (values or {}).items() if k and v != ""}
                result = db[table].insert_one(doc)
                return {"ok": True, "id": str(result.inserted_id)}

            schema_columns, _pk_column = fetch_schema(conn, engine, table)
            by_name = {c["name"]: c for c in schema_columns}
            cols, params = [], []
            for key, raw in (values or {}).items():
                if key not in by_name:
                    continue
                col = by_name[key]
                coerced, err = _coerce_value(raw, col["family"], col["nullable"], col["has_default"])
                if err:
                    return {"error": f'Colonne "{key}" : {err}'}
                if coerced is _SKIP:
                    continue
                cols.append(key)
                params.append(coerced)
            if not cols:
                return {"error": "Aucune valeur à insérer"}
            quote = "`" if engine == "mysql" else '"'
            quoted_table = f"{quote}{table}{quote}"
            quoted_cols = ", ".join(f"{quote}{c}{quote}" for c in cols)
            placeholder = "?" if engine == "sqlite" else "%s"
            placeholders = ", ".join([placeholder] * len(cols))
            cur = conn.cursor()
            cur.execute(f"INSERT INTO {quoted_table} ({quoted_cols}) VALUES ({placeholders})", tuple(params))
            conn.commit()
            cur.close()
            return {"ok": True}
        except Exception as e:
            conn.rollback()
            return {"error": str(e)}
        finally:
            conn.close()

    def db_update_cell(self, path, table, column, value, pk_column, pk_value):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or "") or not re.match(r"^[a-zA-Z0-9_$.-]+$", column or ""):
            return {"error": "Nom invalide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                from bson import ObjectId

                try:
                    oid = ObjectId(pk_value)
                except Exception:
                    oid = pk_value
                db = conn[mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                db[table].update_one({"_id": oid}, {"$set": {column: value}})
                return {"ok": True}

            schema_columns, _pk = fetch_schema(conn, engine, table)
            by_name = {c["name"]: c for c in schema_columns}
            if column not in by_name:
                return {"error": "Colonne inconnue"}
            col = by_name[column]
            # has_default=False: an explicit edit that's left blank means "set
            # NULL" (if nullable), never "leave the DB default alone" like insert.
            coerced, err = _coerce_value(value, col["family"], col["nullable"], False)
            if err:
                return {"error": f'Colonne "{column}" : {err}'}
            quote = "`" if engine == "mysql" else '"'
            quoted_table = f"{quote}{table}{quote}"
            quoted_col = f"{quote}{column}{quote}"
            quoted_pk = f"{quote}{pk_column}{quote}"
            placeholder = "?" if engine == "sqlite" else "%s"
            cur = conn.cursor()
            cur.execute(
                f"UPDATE {quoted_table} SET {quoted_col} = {placeholder} WHERE {quoted_pk} = {placeholder}",
                (coerced, pk_value),
            )
            conn.commit()
            cur.close()
            return {"ok": True}
        except Exception as e:
            conn.rollback()
            return {"error": str(e)}
        finally:
            conn.close()
