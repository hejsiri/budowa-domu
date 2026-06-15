import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  BanknoteArrowDown,
  Check,
  ClipboardList,
  FileText,
  Home,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Paperclip,
  Plus,
  Settings,
  SquarePen,
  Trash,
  X,
} from 'lucide-react'
import './App.css'

type TaskStatus = 'todo' | 'done'
type PaymentStatus = 'unpaid' | 'paid'
type CostPayer = 'me' | 'partner' | 'half' | 'custom'
type ActiveSection = 'tasks' | 'costs' | 'settings'
type AuthMode = 'login' | 'register' | 'verify'

type AuthStatus = {
  authenticated: boolean
  setupRequired: boolean
  email: string
}

type Task = {
  id: string
  title: string
  area: string
  priority: string
  dueDate: string
  status: TaskStatus
  comment?: string
  attachments?: Attachment[]
}

type Attachment = {
  name: string
  path: string
  mimeType: string
}

type Cost = {
  id: string
  title: string
  area: string
  category: string
  amount: number
  payer?: CostPayer
  investorShare?: number
  partnerShare?: number
  status: PaymentStatus
  paidDate: string
  attachment?: Attachment
}

type SettingsState = {
  investors: {
    primary: string
    partner: string
  }
}

type AppState = {
  tasks: Task[]
  costs: Cost[]
  settings?: SettingsState
}

const defaultSettings: SettingsState = {
  investors: {
    primary: 'Ja',
    partner: 'Drugi inwestor',
  },
}

const emptyState: AppState = { tasks: [], costs: [], settings: defaultSettings }

const numberParts = new Intl.NumberFormat('pl-PL', {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatWithThousands(value: number | string) {
  const [integerPart, decimalPart] = String(value).split(',')
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return decimalPart === undefined ? grouped : `${grouped},${decimalPart}`
}

function formatCurrency(value: number) {
  return `${formatWithThousands(numberParts.format(value))} zł`
}

function formatInteger(value: number) {
  return formatWithThousands(Math.round(value))
}

function normalizeShare(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(100, Math.max(0, value))
}

function costSplit(cost: Pick<Cost, 'payer' | 'investorShare' | 'partnerShare'>, settings = defaultSettings) {
  const primaryName = settings.investors.primary || defaultSettings.investors.primary
  const partnerName = settings.investors.partner || defaultSettings.investors.partner

  if (cost.payer === 'partner') {
    return { label: `Płaci ${partnerName}`, investorShare: 0, partnerShare: 100 }
  }

  if (cost.payer === 'half') {
    return { label: 'Płatność na pół', investorShare: 50, partnerShare: 50 }
  }

  if (cost.payer === 'custom') {
    const investorShare = normalizeShare(Number(cost.investorShare ?? 50))
    return {
      label: 'Inny podział',
      investorShare,
      partnerShare: normalizeShare(Number(cost.partnerShare ?? 100 - investorShare)),
    }
  }

  return { label: `Płaci ${primaryName}`, investorShare: 100, partnerShare: 0 }
}

const today = new Date().toISOString().slice(0, 10)
const isDevServer = import.meta.env.DEV

function apiEndpoint(resource: string, id?: string, action?: string) {
  if (isDevServer) {
    if (resource === 'auth') {
      return action ? `/api/auth/${action}` : '/api/auth'
    }

    const suffix = id ? `/${id}${action ? `/${action}` : ''}` : ''
    return `/api/${resource}${suffix}`
  }

  const params = new URLSearchParams({ resource })
  if (id) {
    params.set('id', id)
  }
  if (action) {
    params.set('action', action)
  }

  return `api.php?${params.toString()}`
}

function attachmentHref(path: string) {
  const cleanPath = path.replace(/^\//, '')
  return isDevServer
    ? `/api/file?path=${encodeURIComponent(cleanPath)}`
    : `api.php?resource=file&path=${encodeURIComponent(cleanPath)}`
}

function isImageAttachment(attachment: Attachment) {
  return attachment.mimeType.startsWith('image/')
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Nie udalo sie zapisac danych.' }))
    throw new Error(error.message)
  }

  return response.json() as Promise<T>
}

function App() {
  const [auth, setAuth] = useState<AuthStatus>({
    authenticated: false,
    setupRequired: false,
    email: '',
  })
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authLoading, setAuthLoading] = useState(true)
  const [authMessage, setAuthMessage] = useState('')
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    passwordConfirm: '',
    code: '',
  })
  const [state, setState] = useState<AppState>(emptyState)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<ActiveSection>('tasks')
  const [taskView, setTaskView] = useState<TaskStatus | 'all'>('todo')
  const [costView, setCostView] = useState<PaymentStatus | 'all'>('unpaid')
  const [activeModal, setActiveModal] = useState<'task' | 'cost' | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingCostId, setEditingCostId] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<File | undefined>()
  const [taskAttachments, setTaskAttachments] = useState<File[]>([])
  const [taskForm, setTaskForm] = useState({
    title: '',
    area: 'Fundamenty',
    priority: 'Normalne',
    dueDate: today,
    comment: '',
  })
  const [costForm, setCostForm] = useState({
    title: '',
    area: 'Stan surowy',
    category: 'Materialy',
    amount: '',
    payer: 'me' as CostPayer,
    investorShare: '100',
    status: 'unpaid' as PaymentStatus,
    paidDate: '',
  })
  const [settingsForm, setSettingsForm] = useState(defaultSettings.investors)

  const settings = state.settings || defaultSettings

  async function refreshState() {
    setIsLoading(true)
    setError('')

    try {
      const nextState = await requestJson<AppState>(apiEndpoint('state'))
      setState({ ...nextState, settings: nextState.settings || defaultSettings })
      setSettingsForm((nextState.settings || defaultSettings).investors)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie pobrac danych.')
    } finally {
      setIsLoading(false)
    }
  }

  async function refreshAuth() {
    setAuthLoading(true)
    setError('')

    try {
      const status = await requestJson<AuthStatus>(apiEndpoint('auth'))
      setAuth(status)
      setAuthMode(status.setupRequired ? 'register' : 'login')
      if (status.authenticated) {
        await refreshState()
      } else {
        setState(emptyState)
        setIsLoading(false)
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie sprawdzic logowania.')
      setIsLoading(false)
    } finally {
      setAuthLoading(false)
    }
  }

  useEffect(() => {
    // Initial authentication check before loading dashboard data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveModal(null)
        setEditingTaskId(null)
        setEditingCostId(null)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  function resetTaskForm() {
    setTaskForm({
      title: '',
      area: 'Fundamenty',
      priority: 'Normalne',
      dueDate: today,
      comment: '',
    })
    setTaskAttachments([])
  }

  function resetCostForm() {
    setCostForm({
      title: '',
      area: 'Stan surowy',
      category: 'Materialy',
      amount: '',
      payer: 'me',
      investorShare: '100',
      status: 'unpaid',
      paidDate: '',
    })
    setInvoice(undefined)
  }

  function closeModal() {
    setActiveModal(null)
    setEditingTaskId(null)
    setEditingCostId(null)
  }

  function openNewTaskModal() {
    resetTaskForm()
    setEditingTaskId(null)
    setActiveModal('task')
  }

  function openEditTaskModal(task: Task) {
    setTaskForm({
      title: task.title,
      area: task.area,
      priority: task.priority,
      dueDate: task.dueDate,
      comment: task.comment || '',
    })
    setTaskAttachments([])
    setEditingTaskId(task.id)
    setActiveModal('task')
  }

  function openNewCostModal() {
    resetCostForm()
    setEditingCostId(null)
    setActiveModal('cost')
  }

  function openEditCostModal(cost: Cost) {
    setCostForm({
      title: cost.title,
      area: cost.area || 'Stan surowy',
      category: cost.category,
      amount: String(cost.amount),
      payer: cost.payer || 'me',
      investorShare: String(costSplit(cost, settings).investorShare),
      status: cost.status,
      paidDate: cost.paidDate,
    })
    setInvoice(undefined)
    setEditingCostId(cost.id)
    setActiveModal('cost')
  }

  const summary = useMemo(() => {
    const paid = state.costs
      .filter((cost) => cost.status === 'paid')
      .reduce((sum, cost) => sum + cost.amount, 0)
    const unpaid = state.costs
      .filter((cost) => cost.status === 'unpaid')
      .reduce((sum, cost) => sum + cost.amount, 0)

    return {
      total: paid + unpaid,
      paid,
      unpaid,
      todoTasks: state.tasks.filter((task) => task.status === 'todo').length,
      doneTasks: state.tasks.filter((task) => task.status === 'done').length,
    }
  }, [state.costs, state.tasks])

  const filteredTasks = state.tasks.filter((task) => {
    return taskView === 'all' ? true : task.status === taskView
  })

  const filteredCosts = state.costs.filter((cost) => {
    return costView === 'all' ? true : cost.status === costView
  })

  async function runServerAction(action: () => Promise<AppState | Task | Cost>) {
    setError('')

    try {
      const result = await action()
      if ('tasks' in result && 'costs' in result) {
        setState({ ...result, settings: result.settings || settings })
      } else {
        await refreshState()
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie zapisac zmian.')
    }
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!taskForm.title.trim()) {
      return
    }

    const body = new FormData()
    body.append('title', taskForm.title)
    body.append('area', taskForm.area)
    body.append('priority', taskForm.priority)
    body.append('dueDate', taskForm.dueDate)
    body.append('comment', taskForm.comment)
    taskAttachments.forEach((file) => body.append('attachments[]', file))

    await runServerAction(() =>
      requestJson<Task | AppState>(apiEndpoint('tasks', editingTaskId || undefined), {
        method: 'POST',
        body,
      }),
    )
    resetTaskForm()
    event.currentTarget.reset()
    closeModal()
  }

  function toggleTask(id: string) {
    runServerAction(() =>
      requestJson<AppState>(apiEndpoint('tasks', id, 'toggle'), { method: 'PATCH' }),
    )
  }

  function deleteTask(id: string) {
    runServerAction(() => requestJson<AppState>(apiEndpoint('tasks', id), { method: 'DELETE' }))
  }

  function onTaskAttachmentsChange(event: ChangeEvent<HTMLInputElement>) {
    setTaskAttachments(Array.from(event.target.files || []))
  }

  function onInvoiceChange(event: ChangeEvent<HTMLInputElement>) {
    setInvoice(event.target.files?.[0])
  }

  async function addCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number(costForm.amount)
    if (!costForm.title.trim() || !Number.isFinite(amount) || amount <= 0) {
      return
    }

    const body = new FormData()
    body.append('title', costForm.title)
    body.append('area', costForm.area)
    body.append('category', costForm.category)
    body.append('amount', costForm.amount)
    body.append('payer', costForm.payer)
    body.append('investorShare', costForm.investorShare)
    body.append('partnerShare', String(100 - normalizeShare(Number(costForm.investorShare))))
    body.append('status', costForm.status)
    body.append('paidDate', costForm.paidDate)
    if (invoice) {
      body.append('invoice', invoice)
    }

    await runServerAction(() =>
      requestJson<Cost | AppState>(apiEndpoint('costs', editingCostId || undefined), {
        method: 'POST',
        body,
      }),
    )
    resetCostForm()
    event.currentTarget.reset()
    closeModal()
  }

  function toggleCost(id: string) {
    runServerAction(() =>
      requestJson<AppState>(apiEndpoint('costs', id, 'toggle'), { method: 'PATCH' }),
    )
  }

  function deleteCost(id: string) {
    runServerAction(() => requestJson<AppState>(apiEndpoint('costs', id), { method: 'DELETE' }))
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runServerAction(() =>
      requestJson<AppState>(apiEndpoint('settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investors: settingsForm }),
      }),
    )
  }

  async function startRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setAuthMessage('')

    try {
      const result = await requestJson<{ message: string; developmentCode?: string }>(
        apiEndpoint('auth', undefined, 'register-start'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(authForm),
        },
      )
      setAuthMessage(
        result.developmentCode
          ? `${result.message} Kod lokalny: ${result.developmentCode}`
          : result.message,
      )
      setAuthMode('verify')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie rozpoczac rejestracji.')
    }
  }

  async function verifyRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setAuthMessage('')

    try {
      const result = await requestJson<{ message: string }>(
        apiEndpoint('auth', undefined, 'register-verify'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: authForm.code }),
        },
      )
      setAuthMessage(result.message)
      setAuth((current) => ({ ...current, setupRequired: false }))
      setAuthMode('login')
      setAuthForm((current) => ({ ...current, password: '', passwordConfirm: '', code: '' }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie potwierdzic kodu.')
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setAuthMessage('')

    try {
      const result = await requestJson<AuthStatus>(apiEndpoint('auth', undefined, 'login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm),
      })
      setAuth({ authenticated: true, setupRequired: false, email: result.email })
      await refreshState()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie zalogowac.')
    }
  }

  async function logout() {
    setError('')
    await requestJson(apiEndpoint('auth', undefined, 'logout'), { method: 'POST' }).catch(() => undefined)
    setAuth({ authenticated: false, setupRequired: false, email: '' })
    setState(emptyState)
    setAuthMode('login')
  }

  if (authLoading) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <span className="auth-mark">
            <Home size={24} />
          </span>
          <p>Budowa domu</p>
          <h1>Sprawdzam dostęp</h1>
          <div className="auth-empty">Ładowanie...</div>
        </section>
      </main>
    )
  }

  if (!auth.authenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <span className="auth-mark">
            {authMode === 'verify' ? <KeyRound size={24} /> : <Lock size={24} />}
          </span>
          <p>Panel inwestora</p>
          <h1>
            {authMode === 'register'
              ? 'Utwórz pierwsze konto'
              : authMode === 'verify'
                ? 'Wpisz kod z emaila'
                : 'Zaloguj się'}
          </h1>

          {error && <div className="notice auth-notice">{error}</div>}
          {authMessage && <div className="auth-success">{authMessage}</div>}

          {authMode === 'register' && (
            <form className="auth-form" onSubmit={startRegistration}>
              <label>
                <span>Adres email</span>
                <div className="auth-input">
                  <Mail size={18} />
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                    autoComplete="email"
                    autoFocus
                    required
                  />
                </div>
              </label>
              <label>
                <span>Hasło</span>
                <div className="auth-input">
                  <Lock size={18} />
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>
              </label>
              <label>
                <span>Powtórz hasło</span>
                <div className="auth-input">
                  <Lock size={18} />
                  <input
                    type="password"
                    value={authForm.passwordConfirm}
                    onChange={(event) =>
                      setAuthForm({ ...authForm, passwordConfirm: event.target.value })
                    }
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>
              </label>
              <button className="primary-action auth-submit" type="submit">
                <Mail size={18} />
                Wyślij kod
              </button>
            </form>
          )}

          {authMode === 'verify' && (
            <form className="auth-form" onSubmit={verifyRegistration}>
              <label>
                <span>Kod weryfikacyjny</span>
                <div className="auth-input">
                  <KeyRound size={18} />
                  <input
                    inputMode="numeric"
                    value={authForm.code}
                    onChange={(event) => setAuthForm({ ...authForm, code: event.target.value })}
                    placeholder="000000"
                    autoFocus
                    required
                  />
                </div>
              </label>
              <button className="primary-action auth-submit" type="submit">
                <Check size={18} />
                Potwierdź konto
              </button>
            </form>
          )}

          {authMode === 'login' && (
            <form className="auth-form" onSubmit={login}>
              <label>
                <span>Adres email</span>
                <div className="auth-input">
                  <Mail size={18} />
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                    autoComplete="email"
                    autoFocus
                    required
                  />
                </div>
              </label>
              <label>
                <span>Hasło</span>
                <div className="auth-input">
                  <Lock size={18} />
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </label>
              <button className="primary-action auth-submit" type="submit">
                <Lock size={18} />
                Zaloguj się
              </button>
            </form>
          )}
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      {error && <div className="notice">{error}</div>}

      <header className="page-hero">
        <div className="brand">
          <span className="brand-mark">
            <Home size={25} />
          </span>
          <p>Panel inwestora</p>
          <h1>Budowa domu</h1>
          <button className="logout-button" onClick={logout}>
            <LogOut size={16} />
            Wyloguj
          </button>
        </div>

        <section className="stats-grid" aria-label="Podsumowanie">
          <article className="stat-panel total">
            <span>Budzet wpisany</span>
            <strong>{formatCurrency(summary.total)}</strong>
            <small>Wszystkie wydatki z rejestru</small>
          </article>
          <article className="stat-panel">
            <span>Do zapłaty</span>
            <strong>{formatCurrency(summary.unpaid)}</strong>
            <small>
              {formatInteger(state.costs.filter((cost) => cost.status === 'unpaid').length)} pozycji
            </small>
          </article>
          <article className="stat-panel">
            <span>Zapłacone</span>
            <strong>{formatCurrency(summary.paid)}</strong>
            <small>
              {formatInteger(state.costs.filter((cost) => cost.status === 'paid').length)} pozycji
            </small>
          </article>
          <article className="stat-panel">
            <span>Zadania</span>
            <strong>
              {formatInteger(summary.todoTasks)}/{formatInteger(summary.todoTasks + summary.doneTasks)}
            </strong>
            <small>Do zrobienia / razem</small>
          </article>
        </section>

        <nav className="section-tabs" aria-label="Widok panelu" role="tablist">
          <button
            className={activeSection === 'tasks' ? 'active' : ''}
            role="tab"
            aria-selected={activeSection === 'tasks'}
            aria-controls="tasks-panel"
            id="tasks-tab"
            onClick={() => setActiveSection('tasks')}
          >
            <ClipboardList size={18} />
            Zadania
          </button>
          <button
            className={activeSection === 'costs' ? 'active' : ''}
            role="tab"
            aria-selected={activeSection === 'costs'}
            aria-controls="costs-panel"
            id="costs-tab"
            onClick={() => setActiveSection('costs')}
          >
            <BanknoteArrowDown size={18} />
            Wydatki
          </button>
          <button
            className={activeSection === 'settings' ? 'active' : ''}
            role="tab"
            aria-selected={activeSection === 'settings'}
            aria-controls="settings-panel"
            id="settings-tab"
            onClick={() => setActiveSection('settings')}
          >
            <Settings size={18} />
            Ustawienia
          </button>
        </nav>
      </header>

      <section className="workspace">
        {activeSection === 'tasks' && (
        <section className="module" id="tasks-panel" role="tabpanel" aria-labelledby="tasks-tab">
          <div className="module-heading">
            <div>
              <p>Zadania budowy</p>
              <h2>Do zrobienia i zrobione</h2>
            </div>
            <div className="module-actions">
              <ClipboardList size={24} />
              <button className="heading-action" onClick={openNewTaskModal}>
                <Plus size={18} />
                Dodaj zadanie
              </button>
            </div>
          </div>

          <div className="segmented" aria-label="Filtr zadan">
            <button className={taskView === 'todo' ? 'active' : ''} onClick={() => setTaskView('todo')}>
              Do zrobienia
            </button>
            <button className={taskView === 'done' ? 'active' : ''} onClick={() => setTaskView('done')}>
              Zrobione
            </button>
            <button className={taskView === 'all' ? 'active' : ''} onClick={() => setTaskView('all')}>
              Wszystkie
            </button>
          </div>

          <div className="list">
            {isLoading ? <p className="empty">Laduje dane z serwera...</p> : null}
            {!isLoading && filteredTasks.length === 0 ? <p className="empty">Brak zadan w tym widoku.</p> : null}
            {filteredTasks.map((task) => (
              <article className={`item-card task-card priority-${task.priority.toLowerCase()}`} key={task.id}>
                <button
                  className={`status-dot ${task.status}`}
                  onClick={() => toggleTask(task.id)}
                  title={task.status === 'done' ? 'Oznacz jako do zrobienia' : 'Oznacz jako zrobione'}
                >
                  {task.status === 'done' && <Check size={16} />}
                </button>
                <div className="item-main">
                  <div className="item-title-row">
                    <h3>{task.title}</h3>
                    <span className={`badge ${task.priority.toLowerCase()}`}>{task.priority}</span>
                  </div>
                  <p>
                    {task.area} · termin {task.dueDate || 'bez daty'}
                  </p>
                  {task.comment && <p className="item-comment">{task.comment}</p>}
                  {task.attachments && task.attachments.length > 0 && (
                    <div className="attachment-list">
                      {task.attachments.map((attachment) => (
                        isImageAttachment(attachment) ? (
                          <a
                            className="attachment-thumb"
                            href={attachmentHref(attachment.path)}
                            target="_blank"
                            key={attachment.path}
                            title={attachment.name}
                          >
                            <img src={attachmentHref(attachment.path)} alt={attachment.name} loading="lazy" />
                          </a>
                        ) : (
                          <a
                            className="attachment-link"
                            href={attachmentHref(attachment.path)}
                            target="_blank"
                            key={attachment.path}
                          >
                            <FileText size={16} />
                            {attachment.name}
                          </a>
                        )
                      ))}
                    </div>
                  )}
                </div>
                <div className="item-actions">
                  <button
                    className="icon-button edit-button"
                    onClick={() => openEditTaskModal(task)}
                    title="Edytuj zadanie"
                  >
                    <SquarePen size={17} />
                  </button>
                  <button className="icon-button" onClick={() => deleteTask(task.id)} title="Usun zadanie">
                    <Trash size={18} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        )}

        {activeSection === 'costs' && (
        <section className="module" id="costs-panel" role="tabpanel" aria-labelledby="costs-tab">
          <div className="module-heading">
            <div>
              <p>Wydatki budowy</p>
              <h2>Faktury, platnosci i sumy</h2>
            </div>
            <div className="module-actions">
              <BanknoteArrowDown size={24} />
              <button className="heading-action" onClick={openNewCostModal}>
                <Plus size={18} />
                Dodaj wydatek
              </button>
            </div>
          </div>

          <div className="segmented" aria-label="Filtr wydatkow">
            <button
              className={costView === 'unpaid' ? 'active' : ''}
              onClick={() => setCostView('unpaid')}
            >
              Do zapłaty
            </button>
            <button className={costView === 'paid' ? 'active' : ''} onClick={() => setCostView('paid')}>
              Zapłacone
            </button>
            <button className={costView === 'all' ? 'active' : ''} onClick={() => setCostView('all')}>
              Wszystkie
            </button>
          </div>

          <div className="list">
            {isLoading ? <p className="empty">Laduje wydatki z serwera...</p> : null}
            {!isLoading && filteredCosts.length === 0 ? <p className="empty">Brak wydatkow w tym widoku.</p> : null}
            {filteredCosts.map((cost) => (
              <article className="item-card cost-card" key={cost.id}>
                <button
                  className={`status-dot ${cost.status}`}
                  onClick={() => toggleCost(cost.id)}
                  title={cost.status === 'paid' ? 'Oznacz jako do zaplaty' : 'Oznacz jako zaplacone'}
                >
                  {cost.status === 'paid' && <Check size={16} />}
                </button>
                <div className="item-main">
                  <div className="item-title-row">
                    <h3>{cost.title}</h3>
                    <strong>{formatCurrency(cost.amount)}</strong>
                  </div>
                  <p>
                    {cost.area || 'Fundamenty'} · {cost.category} ·{' '}
                    {cost.status === 'paid'
                      ? `zaplacone ${cost.paidDate || 'bez daty'}`
                      : 'do zaplaty'}
                  </p>
                  <p className="cost-split">
                    {costSplit(cost, settings).label}: {settings.investors.primary}{' '}
                    {formatCurrency((cost.amount * costSplit(cost, settings).investorShare) / 100)}
                    , {settings.investors.partner}{' '}
                    {formatCurrency((cost.amount * costSplit(cost, settings).partnerShare) / 100)}
                  </p>
                  {cost.attachment && (
                    <a
                      className="attachment-link"
                      href={attachmentHref(cost.attachment.path)}
                      target="_blank"
                    >
                      <FileText size={16} />
                      {cost.attachment.name}
                    </a>
                  )}
                </div>
                <div className="item-actions">
                  <button
                    className="icon-button edit-button"
                    onClick={() => openEditCostModal(cost)}
                    title="Edytuj wydatek"
                  >
                    <SquarePen size={17} />
                  </button>
                  <button className="icon-button" onClick={() => deleteCost(cost.id)} title="Usun wydatek">
                    <Trash size={18} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        )}

        {activeSection === 'settings' && (
        <section className="module" id="settings-panel" role="tabpanel" aria-labelledby="settings-tab">
          <div className="module-heading">
            <div>
              <p>Konfiguracja</p>
              <h2>Inwestorzy</h2>
            </div>
            <div className="module-actions">
              <Settings size={24} />
            </div>
          </div>

          <form className="entry-form settings-form" onSubmit={saveSettings}>
            <label>
              <span>Pierwszy inwestor</span>
              <input
                value={settingsForm.primary}
                onChange={(event) => setSettingsForm({ ...settingsForm, primary: event.target.value })}
                placeholder="np. Paweł"
              />
            </label>
            <label>
              <span>Drugi inwestor</span>
              <input
                value={settingsForm.partner}
                onChange={(event) => setSettingsForm({ ...settingsForm, partner: event.target.value })}
                placeholder="np. Anna"
              />
            </label>
            <div className="modal-actions">
              <button type="submit" className="primary-action">
                <Check size={18} />
                Zapisz ustawienia
              </button>
            </div>
          </form>
        </section>
        )}
      </section>

      {activeModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p>{activeModal === 'task' ? 'Zadania budowy' : 'Wydatki budowy'}</p>
                <h2 id="modal-title">
                  {activeModal === 'task'
                    ? editingTaskId
                      ? 'Edytuj zadanie'
                      : 'Dodaj zadanie'
                    : editingCostId
                      ? 'Edytuj wydatek'
                      : 'Dodaj wydatek'}
                </h2>
              </div>
              <button className="modal-close" onClick={closeModal} title="Zamknij">
                <X size={20} />
              </button>
            </div>

            {activeModal === 'task' ? (
              <form className="entry-form modal-form" onSubmit={addTask}>
                <label className="wide">
                  <span>Nazwa zadania</span>
                  <input
                    value={taskForm.title}
                    onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
                    placeholder="np. Zamowic beton B25"
                    autoFocus
                  />
                </label>
                <label>
                  <span>Etap</span>
                  <select
                    value={taskForm.area}
                    onChange={(event) => setTaskForm({ ...taskForm, area: event.target.value })}
                  >
                    <option>Fundamenty</option>
                    <option value="Sciany">Ściany</option>
                    <option>Dach</option>
                    <option>Instalacje</option>
                    <option value="Wykonczenie">Wykończenie</option>
                    <option>Dokumenty</option>
                    <option value="Materialy">Materiały</option>
                  </select>
                </label>
                <label>
                  <span>Priorytet</span>
                  <select
                    value={taskForm.priority}
                    onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })}
                  >
                    <option>Normalne</option>
                    <option>Pilne</option>
                    <option>Niskie</option>
                  </select>
                </label>
                <label>
                  <span>Termin</span>
                  <input
                    type="date"
                    value={taskForm.dueDate}
                    onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value })}
                  />
                </label>
                <label className="wide">
                  <span>Komentarz</span>
                  <textarea
                    value={taskForm.comment}
                    onChange={(event) => setTaskForm({ ...taskForm, comment: event.target.value })}
                    placeholder="np. ustalenia z ekipą, uwagi do odbioru"
                    rows={4}
                  />
                </label>
                <label className="file-input wide">
                  <span>{editingTaskId ? 'Nowe załączniki' : 'Załączniki'}</span>
                  <input type="file" accept="image/*,.pdf" multiple onChange={onTaskAttachmentsChange} />
                  <em>
                    <Paperclip size={16} />
                    {taskAttachments.length > 0
                      ? taskAttachments.map((file) => file.name).join(', ')
                      : editingTaskId
                        ? 'Zostaw bez zmian lub dodaj pliki'
                        : 'Dodaj PDF albo zdjęcia'}
                  </em>
                </label>
                <div className="modal-actions">
                  <button type="button" className="secondary-action" onClick={closeModal}>
                    Anuluj
                  </button>
                  <button type="submit" className="primary-action">
                    {editingTaskId ? <Check size={18} /> : <Plus size={18} />}
                    {editingTaskId ? 'Zapisz zmiany' : 'Dodaj zadanie'}
                  </button>
                </div>
              </form>
            ) : (
              <form className="entry-form cost-form modal-form" onSubmit={addCost}>
                <label className="wide">
                  <span>Opis wydatku</span>
                  <input
                    value={costForm.title}
                    onChange={(event) => setCostForm({ ...costForm, title: event.target.value })}
                    placeholder="np. Transport bloczkow"
                    autoFocus
                  />
                </label>
                <label>
                  <span>Etap</span>
                  <select
                    value={costForm.area}
                    onChange={(event) => setCostForm({ ...costForm, area: event.target.value })}
                  >
                    <option>Przygotowanie</option>
                    <option>Fundamenty</option>
                    <option>Stan surowy</option>
                    <option>Dach</option>
                    <option>Instalacje</option>
                    <option value="Wykonczenie">Wykończenie</option>
                    <option>Odbiory</option>
                    <option>Dokumenty</option>
                  </select>
                </label>
                <label>
                  <span>Kategoria</span>
                  <select
                    value={costForm.category}
                    onChange={(event) => setCostForm({ ...costForm, category: event.target.value })}
                  >
                    <option value="Materialy">Materiały</option>
                    <option>Robocizna</option>
                    <option value="Sprzet">Sprzęt</option>
                    <option>Dokumenty</option>
                    <option>Transport</option>
                    <option>Inne</option>
                  </select>
                </label>
                <label>
                  <span>Kwota PLN</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={costForm.amount}
                    onChange={(event) => setCostForm({ ...costForm, amount: event.target.value })}
                    placeholder="0,00"
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={costForm.status}
                    onChange={(event) =>
                      setCostForm({ ...costForm, status: event.target.value as PaymentStatus })
                    }
                  >
                    <option value="unpaid">Do zapłaty</option>
                    <option value="paid">Zapłacone</option>
                  </select>
                </label>
                <label>
                  <span>Kto płaci</span>
                  <select
                    value={costForm.payer}
                    onChange={(event) => {
                      const payer = event.target.value as CostPayer
                      const investorShare =
                        payer === 'me' ? '100' : payer === 'partner' ? '0' : payer === 'half' ? '50' : costForm.investorShare
                      setCostForm({ ...costForm, payer, investorShare })
                    }}
                  >
                    <option value="me">{settings.investors.primary}</option>
                    <option value="partner">{settings.investors.partner}</option>
                    <option value="half">Na pół</option>
                    <option value="custom">Inny podział</option>
                  </select>
                </label>
                {costForm.payer === 'custom' && (
                  <label>
                    <span>Udział: {settings.investors.primary} %</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={costForm.investorShare}
                      onChange={(event) =>
                        setCostForm({ ...costForm, investorShare: event.target.value })
                      }
                      placeholder="50"
                    />
                  </label>
                )}
                <label>
                  <span>Kiedy zaplacono</span>
                  <input
                    type="date"
                    value={costForm.paidDate}
                    disabled={costForm.status === 'unpaid'}
                    onChange={(event) => setCostForm({ ...costForm, paidDate: event.target.value })}
                  />
                </label>
                <label className="file-input wide">
                  <span>{editingCostId ? 'Nowa faktura' : 'Faktura'}</span>
                  <input type="file" accept="image/*,.pdf" onChange={onInvoiceChange} />
                  <em>
                    <Paperclip size={16} />
                    {invoice ? invoice.name : editingCostId ? 'Zostaw bez zmian lub dodaj plik' : 'Dodaj plik'}
                  </em>
                </label>
                <div className="modal-actions">
                  <button type="button" className="secondary-action" onClick={closeModal}>
                    Anuluj
                  </button>
                  <button type="submit" className="primary-action">
                    {editingCostId ? <Check size={18} /> : <Plus size={18} />}
                    {editingCostId ? 'Zapisz zmiany' : 'Dodaj wydatek'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

export default App
