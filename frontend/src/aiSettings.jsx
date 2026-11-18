import { useCallback, useEffect, useState } from 'react'
import {
  IconAlertCircle,
  IconCheck,
  IconChevronLeft,
  IconChevronDown,
  IconClaude,
  IconCodex,
  IconCopy,
  IconTerminal,
} from './icons'
import { AccountRows } from './aiAccounts'
import { AppIcon, Group, Row, RowInput, Section, SelectField, Segmented, Switch } from './settingsUi'

function api() {
  return window.pywebview?.api
}

// The CLI agents Dev Hub can drive. Claude Code and Codex are configured side
// by side; which one runs is picked each time (commit message, IA session),
// the default only covers "nothing chosen" and Hubi.
export const AGENT_META = {
  'claude-code': {
    label: 'Claude',
    full: 'Claude Code',
    Logo: IconClaude,
    blurb: "L'agent d'Anthropic, avec ton abonnement Claude.",
    placeholder: 'claude -p',
  },
  codex: {
    label: 'Codex',
    full: 'Codex',
    Logo: IconCodex,
    blurb: "L'agent d'OpenAI, avec ton compte ChatGPT.",
    placeholder: 'codex exec --skip-git-repo-check',
  },
  cli: {
    label: 'Autre CLI',
    full: 'Autre CLI',
    Logo: IconTerminal,
    blurb: 'Un autre agent en ligne de commande (gemini, aider…).',
    placeholder: 'ma-commande -p',
  },
}

const AGENT_IDS = ['claude-code', 'codex', 'cli']

// Mirrors DEFAULT_CLI_COMMANDS in backend/app_config.py. Plain "claude -p"
// boots a full session (CLAUDE.md, MCP servers…) and took 30s+ for a commit
// message; these flags skip all that while keeping the subscription login.
const DEFAULT_COMMANDS = {
  'claude-code': 'claude -p --setting-sources user --strict-mcp-config --tools "" --no-session-persistence',
  codex: 'codex exec --skip-git-repo-check',
  cli: '',
}

const API_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  { id: 'anthropic', label: 'Anthropic (API)', defaultBaseUrl: '', defaultModel: 'claude-sonnet-4-5' },
  { id: 'custom', label: 'Autre API (URL perso)', defaultBaseUrl: '', defaultModel: '' },
]

const COMMIT_LANGUAGES = [
  { value: 'auto', label: 'Auto' },
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'Anglais' },
  { value: 'es', label: 'Espagnol' },
  { value: 'de', label: 'Allemand' },
  { value: 'pt', label: 'Portugais' },
]

/** Agents + which are installed, from the backend (one call, shared by pickers). */
export function useAiAgents() {
  const [data, setData] = useState(null)
  const reload = useCallback(async () => {
    const r = await api()?.get_ai_agents?.()
    if (r?.agents) setData(r)
    return r
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return {
    agents: data?.agents || [],
    defaultAgent: data?.default || null,
    commitProvider: data?.commit_provider || null,
    loaded: !!data,
    reload,
  }
}

/**
 * Options for AgentPicker: the installed agents, plus — for the commit
 * picker — the configured API provider when that is the default engine.
 */
export function agentOptions(agents, commitProvider) {
  const options = agents.filter((a) => a.installed).map((a) => ({ id: a.id, ...AGENT_META[a.id] }))
  if (commitProvider && !AGENT_META[commitProvider]) {
    const api = API_PROVIDERS.find((p) => p.id === commitProvider)
    options.push({ id: commitProvider, label: api?.label || 'API', full: api?.label || 'API', Logo: null })
  }
  return options
}

/** Segmented Claude / Codex (…) choice with the logos. */
export function AgentPicker({ options, value, onChange, disabled, className = '' }) {
  if (!options.length) return null
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-lg border border-border bg-base p-0.5 ${className}`}>
      {options.map((o) => {
        const active = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.id)}
            title={o.full || o.label}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? 'bg-accent-bg text-text shadow-sm ring-1 ring-accent/50' : 'text-muted hover:bg-surface-hover hover:text-text'
            }`}
          >
            {o.Logo && <o.Logo className="h-3.5 w-3.5 shrink-0" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ----------------------------------------------------------------------- page

function StatusText({ tone, children }) {
  const color = { ok: 'text-success', bad: 'text-warning', none: 'text-muted' }[tone]
  return (
    <span className={`flex items-center gap-1.5 text-[13px] ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}

function AgentSection({ id, command, onCommand, installed, isDefault, onMakeDefault, test, onTest, onNotify }) {
  const meta = AGENT_META[id]
  const [advancedOpen, setAdvancedOpen] = useState(id === 'cli')
  const isCustom = id === 'cli'
  const configured = !!command.trim()
  const preset = DEFAULT_COMMANDS[id]
  const status = isCustom
    ? configured
      ? installed
        ? { tone: 'ok', text: 'Détecté' }
        : { tone: 'bad', text: 'Introuvable' }
      : { tone: 'none', text: 'Non configuré' }
    : installed
      ? { tone: 'ok', text: 'Installé' }
      : { tone: 'bad', text: 'Introuvable' }

  return (
    <Section>
      <Group>
        <Row
          inset
          leading={
            <AppIcon size={40}>
              <meta.Logo className="h-[22px] w-[22px]" />
            </AppIcon>
          }
          title={<span className="text-[15px] font-semibold">{meta.full}</span>}
          subtitle={meta.blurb}
          right={<StatusText tone={status.tone}>{status.text}</StatusText>}
        />
        {!isCustom && <AccountRows agent={id} installed={installed} onNotify={onNotify} label={meta.full} />}
      </Group>

      <Group>
        <Row
          title="Utiliser par défaut"
          subtitle="Pour les sessions IA et Hubi, quand tu n'en choisis pas un autre."
          right={<Switch checked={isDefault} disabled={!configured && !isDefault} onChange={(on) => on && onMakeDefault()} />}
        />
        {!isCustom && (
          <Row
            title="Avancé"
            subtitle="Commande lancée par Dev Hub"
            onClick={() => setAdvancedOpen((v) => !v)}
            right={<IconChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${advancedOpen ? '' : '-rotate-90'}`} />}
          />
        )}
        {(advancedOpen || isCustom) && (
          <>
            <Row title="Commande">
              <RowInput
                mono
                value={command}
                onChange={(e) => onCommand(e.target.value)}
                placeholder={meta.placeholder}
                spellCheck={false}
              />
            </Row>
            <Row
              tone="accent"
              title={test?.testing ? 'Test en cours…' : 'Tester la commande'}
              onClick={test?.testing || !configured ? undefined : onTest}
              disabled={!configured}
              right={
                test?.result ? (
                  <span className={`flex items-center gap-1 text-[12.5px] ${test.result.ok ? 'text-success' : 'text-danger'}`}>
                    {test.result.ok ? <IconCheck className="h-3.5 w-3.5" /> : <IconAlertCircle className="h-3.5 w-3.5" />}
                    <span className="max-w-56 truncate" title={test.result.error}>
                      {test.result.ok ? 'Opérationnel' : test.result.error}
                    </span>
                  </span>
                ) : null
              }
            />
            {preset && command.trim() !== preset && (
              <Row tone="muted" title="Rétablir la commande recommandée" onClick={() => onCommand(preset)} />
            )}
          </>
        )}
      </Group>
    </Section>
  )
}

/**
 * The AI settings page (a full page like Hubi's), laid out like Apple's
 * Settings: one centered column of grouped lists. Both CLI agents with their
 * accounts, the default engine for commit messages, the API providers for
 * those who don't use a CLI. Everything saves by itself.
 */
export function AiSettingsPage({ onClose, onNotify }) {
  const [loaded, setLoaded] = useState(false)
  const [provider, setProvider] = useState('claude-code')
  const [agent, setAgent] = useState('claude-code')
  const [commands, setCommands] = useState({ ...DEFAULT_COMMANDS })
  const [installed, setInstalled] = useState({})
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [commitLanguage, setCommitLanguage] = useState('auto')
  const [lastApi, setLastApi] = useState('openai')
  const [tests, setTests] = useState({})
  const [configPath, setConfigPath] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved

  const refreshInstalled = useCallback(async () => {
    const r = await api()?.get_ai_agents?.()
    if (r?.agents) setInstalled(Object.fromEntries(r.agents.map((a) => [a.id, a.installed])))
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([api()?.get_ai_settings?.(), api()?.get_ai_agents?.(), api()?.get_config_path?.()]).then(([s, a, c]) => {
      if (!alive) return
      if (s) {
        setProvider(s.provider || 'claude-code')
        setAgent(s.agent || 'claude-code')
        setCommands({ ...DEFAULT_COMMANDS, ...(s.cli_commands || {}) })
        setBaseUrl(s.base_url || '')
        setModel(s.model || '')
        setCommitLanguage(s.commit_language || 'auto')
        setHasKey(!!s.has_key)
        if (API_PROVIDERS.some((p) => p.id === s.provider)) setLastApi(s.provider)
      }
      if (a?.agents) setInstalled(Object.fromEntries(a.agents.map((x) => [x.id, x.installed])))
      if (c?.path) setConfigPath(c.path)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const touch = (setter) => (value) => {
    setter(value)
    setDirty(true)
  }
  const setCommand = (id) => (value) => {
    setCommands((prev) => ({ ...prev, [id]: value }))
    setTests((prev) => ({ ...prev, [id]: undefined }))
    setDirty(true)
  }

  function selectProvider(id) {
    if (id === provider) return
    setProvider(id)
    setDirty(true)
    const preset = API_PROVIDERS.find((p) => p.id === id)
    if (preset) {
      setLastApi(id)
      setBaseUrl(preset.defaultBaseUrl)
      setModel(preset.defaultModel)
    }
  }

  async function testAgent(id) {
    setTests((prev) => ({ ...prev, [id]: { testing: true } }))
    let result
    try {
      result = await api().test_cli_auth(commands[id])
    } catch (e) {
      result = { ok: false, error: e?.message || String(e) }
    }
    setTests((prev) => ({ ...prev, [id]: { result } }))
  }

  // No "Enregistrer" button: changes are saved a moment after the last edit.
  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(async () => {
      setSaveState('saving')
      try {
        const result = await api().save_ai_settings(provider, apiKey, baseUrl, model, null, commitLanguage, commands, agent)
        if (result?.error) {
          onNotify(result.error, true)
          setSaveState('idle')
          return
        }
        setDirty(false)
        if (apiKey) setHasKey(true)
        setApiKey('')
        refreshInstalled()
        setSaveState('saved')
      } catch (e) {
        onNotify(e?.message || String(e), true)
        setSaveState('idle')
      }
    }, 700)
    return () => clearTimeout(timer)
    // onNotify and refreshInstalled change identity: only edits restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, provider, agent, commands, apiKey, baseUrl, model, commitLanguage])

  useEffect(() => {
    if (saveState !== 'saved') return
    const id = setTimeout(() => setSaveState('idle'), 2000)
    return () => clearTimeout(id)
  }, [saveState])

  const isApi = API_PROVIDERS.some((p) => p.id === provider)
  const engine = isApi ? 'api' : provider
  const engineOptions = [
    ...AGENT_IDS.map((id) => ({ value: id, label: AGENT_META[id].label, Logo: AGENT_META[id].Logo })),
    { value: 'api', label: 'API' },
  ]

  return (
    <div className="flex w-full flex-col gap-8 px-10 pb-16">
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[13px] text-accent transition-colors hover:bg-surface-hover"
        >
          <IconChevronLeft className="h-4 w-4" />
          Retour
        </button>
        <span className="ml-auto text-[12px] text-muted">
          {saveState === 'saving' && 'Enregistrement…'}
          {saveState === 'saved' && (
            <span className="flex items-center gap-1 text-success">
              <IconCheck className="h-3 w-3" />
              Enregistré
            </span>
          )}
        </span>
      </div>

      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-3">
          <AppIcon size={60}>
            <IconClaude className="h-8 w-8" />
          </AppIcon>
          <AppIcon size={60}>
            <IconCodex className="h-8 w-8" />
          </AppIcon>
        </div>
        <h2 className="text-[26px] font-semibold tracking-tight">Paramètres IA</h2>
        <p className="max-w-[460px] text-[13.5px] leading-snug text-muted">
          Claude Code et Codex, avec leurs comptes. Tu choisis lequel utiliser à chaque message de commit ou nouvelle
          session.
        </p>
      </header>

      {!loaded ? (
        <p className="text-center text-xs text-muted">Chargement…</p>
      ) : (
        <>
          {AGENT_IDS.map((id) => (
            <AgentSection
              key={id}
              id={id}
              command={commands[id] || ''}
              onCommand={setCommand(id)}
              installed={!!installed[id]}
              isDefault={agent === id}
              onMakeDefault={() => touch(setAgent)(id)}
              test={tests[id]}
              onTest={() => testAgent(id)}
              onNotify={onNotify}
            />
          ))}

          <Section
            title="Messages de commit"
            footer="Moteur utilisé par défaut pour « Générer avec l'IA ». Tu peux en changer à chaque fois dans le panneau Commit."
          >
            <Group>
              <Row
                title="Moteur"
                right={
                  <Segmented
                    options={engineOptions}
                    value={engine}
                    onChange={(v) => selectProvider(v === 'api' ? lastApi : v)}
                  />
                }
              />
              {isApi && (
                <>
                  <Row
                    title="Fournisseur"
                    right={
                      <SelectField
                        value={provider}
                        onChange={selectProvider}
                        options={API_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                      />
                    }
                  />
                  <Row title="Clé API">
                    <RowInput
                      type="password"
                      mono
                      value={apiKey}
                      onChange={(e) => touch(setApiKey)(e.target.value)}
                      placeholder={hasKey ? 'Enregistrée' : 'sk-…'}
                    />
                  </Row>
                  {provider !== 'anthropic' && (
                    <Row title="Base URL">
                      <RowInput
                        mono
                        value={baseUrl}
                        onChange={(e) => touch(setBaseUrl)(e.target.value)}
                        placeholder="https://api.example.com/v1"
                      />
                    </Row>
                  )}
                  <Row title="Modèle">
                    <RowInput mono value={model} onChange={(e) => touch(setModel)(e.target.value)} placeholder="gpt-4o-mini" />
                  </Row>
                </>
              )}
              <Row
                title="Langue des messages"
                right={<SelectField value={commitLanguage} onChange={touch(setCommitLanguage)} options={COMMIT_LANGUAGES} />}
              />
            </Group>
          </Section>

          {configPath && (
            <Section title="Fichier de configuration">
              <Group>
                <Row
                  mono
                  title={configPath}
                  onClick={async () => {
                    let ok = false
                    try {
                      const r = await api()?.copy_to_clipboard?.(configPath)
                      ok = r ? !!r.ok : (await navigator.clipboard.writeText(configPath), true)
                    } catch {
                      ok = false
                    }
                    onNotify(ok ? 'Chemin copié' : 'Copie impossible', !ok)
                  }}
                  right={<IconCopy className="h-4 w-4" />}
                />
              </Group>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
