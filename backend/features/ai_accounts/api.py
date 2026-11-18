from . import login, store


def _check(agent):
    return None if agent in store.AGENTS else {"error": "Agent inconnu"}


class AiAccountsMixin:
    """Accounts of the AI agents (Claude Code, Codex): list, switch, browser
    sign-in. Credentials never cross this boundary — only e-mail, name, plan."""

    def ai_accounts_list(self, agent):
        return _check(agent) or store.list_accounts(agent)

    def ai_account_switch(self, agent, account_id):
        bad = _check(agent)
        if bad:
            return bad
        result = store.switch(agent, account_id)
        if result.get("ok"):
            result["running"] = store.running_cli_count(agent)
        return result

    def ai_account_remove(self, agent, account_id):
        return _check(agent) or store.remove(agent, account_id)

    def ai_account_rename(self, agent, account_id, label):
        return _check(agent) or store.rename(agent, account_id, label)

    def ai_account_logout(self, agent):
        return _check(agent) or login.logout(agent)

    def ai_account_login_start(self, agent, email=None, device=False):
        return _check(agent) or login.start(agent, email or None, bool(device))

    def ai_account_login_status(self, agent):
        return _check(agent) or login.status(agent)

    def ai_account_login_cancel(self, agent):
        return _check(agent) or login.cancel(agent)

    def ai_account_login_code(self, agent, code):
        return _check(agent) or login.submit_code(agent, code)
