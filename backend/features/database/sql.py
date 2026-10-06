class DatabaseSqlMixin:
    def db_run_query(self, path, sql):
        if not (sql or "").strip():
            return {"error": "Requête vide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                return {"error": "L'éditeur SQL n'est pas disponible pour MongoDB — utilise le navigateur de collections."}
            cur = conn.cursor()
            cur.execute(sql)
            if cur.description:
                names = [d[0] for d in cur.description]
                fetched = cur.fetchmany(500)
                rows = [[None if v is None else str(v) for v in row] for row in fetched]
                conn.commit()
                cur.close()
                return {
                    "columns": [{"name": n, "type": "", "family": "text", "is_pk": False, "fk": None} for n in names],
                    "rows": rows,
                    "truncated": len(fetched) == 500,
                }
            rowcount = cur.rowcount
            conn.commit()
            cur.close()
            return {"message": f"{rowcount} ligne(s) affectée(s)", "rowcount": rowcount}
        except Exception as e:
            conn.rollback()
            return {"error": str(e)}
        finally:
            conn.close()

    def db_export_query(self, path, sql):
        if not (sql or "").strip():
            return {"error": "Requête vide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                return {"error": "L'export n'est pas disponible pour MongoDB depuis l'éditeur SQL."}
            cur = conn.cursor()
            cur.execute(sql)
            if not cur.description:
                conn.commit()
                cur.close()
                return {"error": "La requête ne renvoie aucune donnée à exporter."}
            columns = [d[0] for d in cur.description]
            rows = [[None if v is None else str(v) for v in row] for row in cur.fetchall()]
            conn.commit()
            cur.close()
        except Exception as e:
            conn.rollback()
            return {"error": str(e)}
        finally:
            conn.close()

        return self._write_xlsx_dialog(columns, rows, "resultat.xlsx", "Résultat")
