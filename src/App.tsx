import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  BanknoteArrowDown,
  Check,
  ClipboardList,
  FileText,
  Home,
  Paperclip,
  Plus,
  SquarePen,
  Trash,
  X,
} from 'lucide-react'
import './App.css'

type TaskStatus = 'todo' | 'done'
type PaymentStatus = 'unpaid' | 'paid'
type ActiveSection = 'tasks' | 'costs'

type Task = {
  id: string
  title: string
  area: string
  priority: string
  dueDate: string
  status: TaskStatus
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
  status: PaymentStatus
  paidDate: string
  attachment?: Attachment
}

type AppState = {
  tasks: Task[]
  costs: Cost[]
}

const emptyState: AppState = { tasks: [], costs: [] }

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

const today = new Date().toISOString().slice(0, 10)
const isDevServer = import.meta.env.DEV

function apiEndpoint(resource: string, id?: string, action?: string) {
  if (isDevServer) {
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
  return isDevServer ? path : path.replace(/^\//, '')
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Nie udalo sie zapisac danych.' }))
    throw new Error(error.message)
  }

  return response.json() as Promise<T>
}

function App() {
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
  const [taskForm, setTaskForm] = useState({
    title: '',
    area: 'Fundamenty',
    priority: 'Normalne',
    dueDate: today,
  })
  const [costForm, setCostForm] = useState({
    title: '',
    area: 'Stan surowy',
    category: 'Materialy',
    amount: '',
    status: 'unpaid' as PaymentStatus,
    paidDate: '',
  })

  async function refreshState() {
    setIsLoading(true)
    setError('')

    try {
      setState(await requestJson<AppState>(apiEndpoint('state')))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie pobrac danych.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Initial server synchronization for the dashboard data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshState()
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
    setTaskForm({ title: '', area: 'Fundamenty', priority: 'Normalne', dueDate: today })
  }

  function resetCostForm() {
    setCostForm({
      title: '',
      area: 'Stan surowy',
      category: 'Materialy',
      amount: '',
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
    })
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
        setState(result)
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

    await runServerAction(() =>
      requestJson<Task | AppState>(apiEndpoint('tasks', editingTaskId || undefined), {
        method: editingTaskId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskForm),
      }),
    )
    resetTaskForm()
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
              <article className="item-card" key={task.id}>
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
