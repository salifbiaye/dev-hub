from .connect import DatabaseConnectMixin
from .crud import DatabaseCrudMixin
from .export_import import DatabaseExportImportMixin
from .schema import DatabaseSchemaMixin
from .sql import DatabaseSqlMixin


class DatabaseMixin(
    DatabaseConnectMixin,
    DatabaseSchemaMixin,
    DatabaseCrudMixin,
    DatabaseExportImportMixin,
    DatabaseSqlMixin,
):
    pass
