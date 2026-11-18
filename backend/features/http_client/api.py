from . import client


class HttpClientMixin:
    """The "Requêtes" tab: a small HTTP client kept per project."""

    def http_send(self, request, variables=None):
        return client.send_request(request or {}, variables or {})

    def http_load(self, path):
        return client.load_store(path)

    def http_save(self, path, data):
        return client.save_store(path, data)

    def http_guess_base(self, path):
        return client.guess_base(path)

    def http_openapi(self, base_url, insecure=False):
        return client.discover_openapi(base_url, insecure)

    def http_import_routes(self, path, base_url, insecure=False):
        return client.import_routes(path, base_url, insecure)

    def http_import_collection(self):
        from . import collections

        return collections.import_collection()

    def http_export_collection(self, path):
        from pathlib import Path

        from . import collections

        store = client.load_store(path)
        return collections.export_collection(Path(path).name or "collection", store)
