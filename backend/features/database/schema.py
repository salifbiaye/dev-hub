import re

from .connect import mongo_db_name, _db_connections

_INT_TYPES = {"integer", "int", "int2", "int4", "int8", "bigint", "smallint", "tinyint", "mediumint", "serial", "bigserial"}
_FLOAT_TYPES = {"numeric", "decimal", "real", "double precision", "double", "float", "money"}
_BOOL_TYPES = {"boolean", "bool"}
_JSON_TYPES = {"json", "jsonb"}
_DATE_TYPES = {"date"}
_DATETIME_TYPES = {"timestamp", "timestamp without time zone", "timestamp with time zone", "datetime"}
_TIME_TYPES = {"time"}


def _type_family(sql_type):
    t = (sql_type or "").lower().split("(")[0].strip()
    if t == "tinyint(1)" or t in _BOOL_TYPES:
        return "bool"
    if t in _INT_TYPES:
        return "int"
    if t in _FLOAT_TYPES:
        return "float"
    if t in _JSON_TYPES:
        return "json"
    if t in _DATETIME_TYPES:
        return "datetime"
    if t in _DATE_TYPES:
        return "date"
    if t in _TIME_TYPES:
        return "time"
    if "uuid" in t:
        return "uuid"
    return "text"


def fetch_schema(conn, engine, table):
    """Column list (name/type/family/nullable/has_default/is_pk/fk) + the
    single-column primary key name, or None if there isn't exactly one."""
    cur = conn.cursor()
    columns = []
    pk_cols = set()
    fk_map = {}

    if engine == "sqlite":
        cur.execute(f'PRAGMA table_info("{table}")')
        for _cid, name, coltype, notnull, dflt, pk in cur.fetchall():
            columns.append({"name": name, "type": coltype or "", "nullable": not notnull, "has_default": dflt is not None})
            if pk:
                pk_cols.add(name)
        cur.execute(f'PRAGMA foreign_key_list("{table}")')
        for row in cur.fetchall():
            fk_map[row[3]] = {"table": row[2], "column": row[4]}

    elif engine == "postgres":
        cur.execute(
            "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position",
            (table,),
        )
        for name, coltype, nullable, default in cur.fetchall():
            columns.append({"name": name, "type": coltype, "nullable": nullable == "YES", "has_default": default is not None})
        cur.execute(
            "SELECT kcu.column_name FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name "
            "AND tc.table_schema = kcu.table_schema "
            "WHERE tc.table_schema = 'public' AND tc.table_name = %s AND tc.constraint_type = 'PRIMARY KEY'",
            (table,),
        )
        pk_cols = {r[0] for r in cur.fetchall()}
        cur.execute(
            "SELECT kcu.column_name, ccu.table_name, ccu.column_name "
            "FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name "
            "AND tc.table_schema = kcu.table_schema "
            "JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name "
            "AND tc.table_schema = ccu.table_schema "
            "WHERE tc.table_schema = 'public' AND tc.table_name = %s AND tc.constraint_type = 'FOREIGN KEY'",
            (table,),
        )
        for col, ref_table, ref_col in cur.fetchall():
            fk_map[col] = {"table": ref_table, "column": ref_col}

    elif engine == "mysql":
        cur.execute(
            "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = %s ORDER BY ordinal_position",
            (table,),
        )
        for name, coltype, nullable, default in cur.fetchall():
            columns.append({"name": name, "type": coltype, "nullable": nullable == "YES", "has_default": default is not None})
        cur.execute(
            "SELECT column_name FROM information_schema.key_column_usage "
            "WHERE table_schema = DATABASE() AND table_name = %s AND constraint_name = 'PRIMARY'",
            (table,),
        )
        pk_cols = {r[0] for r in cur.fetchall()}
        cur.execute(
            "SELECT column_name, referenced_table_name, referenced_column_name "
            "FROM information_schema.key_column_usage "
            "WHERE table_schema = DATABASE() AND table_name = %s AND referenced_table_name IS NOT NULL",
            (table,),
        )
        for col, ref_table, ref_col in cur.fetchall():
            fk_map[col] = {"table": ref_table, "column": ref_col}

    cur.close()
    for c in columns:
        c["family"] = _type_family(c["type"])
        c["is_pk"] = c["name"] in pk_cols
        c["fk"] = fk_map.get(c["name"])
    pk_column = next(iter(pk_cols)) if len(pk_cols) == 1 else None
    return columns, pk_column


class DatabaseSchemaMixin:
    def db_list_tables(self, path):
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                db = conn[mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                return {"tables": sorted(db.list_collection_names())}
            cur = conn.cursor()
            if engine == "postgres":
                cur.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' ORDER BY table_name"
                )
            elif engine == "mysql":
                cur.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = DATABASE() ORDER BY table_name"
                )
            else:
                cur.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' "
                    "AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )
            tables = [r[0] for r in cur.fetchall()]
            cur.close()
            return {"tables": tables}
        except Exception as e:
            return {"error": str(e)}
        finally:
            conn.close()

    def db_schema_overview(self, path):
        # Every table's columns + FKs in one round trip, reusing the same
        # connection — the ER diagram needs all of them at once to draw
        # relationship lines, so N separate db_table_schema calls would
        # both be slower and reopen the connection every time.
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                db = conn[mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                names = sorted(db.list_collection_names())
                return {"tables": [{"name": n, "columns": [], "pk_column": "_id"} for n in names], "engine": engine}

            cur = conn.cursor()
            if engine == "postgres":
                cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
            elif engine == "mysql":
                cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name")
            else:
                cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            names = [r[0] for r in cur.fetchall()]
            cur.close()

            tables = []
            for name in names:
                columns, pk_column = fetch_schema(conn, engine, name)
                tables.append({"name": name, "columns": columns, "pk_column": pk_column})
            return {"tables": tables, "engine": engine}
        except Exception as e:
            return {"error": str(e)}
        finally:
            conn.close()

    def db_table_schema(self, path, table):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or ""):
            return {"error": "Nom de table invalide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                return {"columns": [], "pk_column": "_id"}
            columns, pk_column = fetch_schema(conn, engine, table)
            return {"columns": columns, "pk_column": pk_column}
        except Exception as e:
            return {"error": str(e)}
        finally:
            conn.close()
