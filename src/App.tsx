import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
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
  StickyNote,
  SquarePen,
  Trash,
  X,
} from 'lucide-react'
import './App.css'

type TaskStatus = 'todo' | 'done'
type PaymentStatus = 'unpaid' | 'paid'
type CostPayer = 'me' | 'partner' | 'half' | 'custom'
type ActiveSection = 'tasks' | 'costs'
type AuthMode = 'login' | 'register' | 'verify'
type TaskView = TaskStatus | 'all'
type CostView = PaymentStatus | 'all'

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
  startTime?: string
  endTime?: string
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
  commentHtml?: string
  status: PaymentStatus
  paidDate: string
  attachment?: Attachment
}

type SettingsState = {
  investors: {
    primary: string
    partner: string
  }
  calendarToken?: string
}

type AppState = {
  tasks: Task[]
  costs: Cost[]
  settings?: SettingsState
}

type NotePreview = {
  title: string
  commentHtml: string
}

const defaultSettings: SettingsState = {
  investors: {
    primary: 'Ja',
    partner: 'Drugi inwestor',
  },
  calendarToken: '',
}

const emptyState: AppState = { tasks: [], costs: [], settings: defaultSettings }
const savedActiveSectionKey = 'budowa.activeSection'
const savedTaskViewKey = 'budowa.taskView'
const savedCostViewKey = 'budowa.costView'

function readSavedSetting<T extends string>(key: string, fallback: T, allowedValues: readonly T[]) {
  if (typeof window === 'undefined') {
    return fallback
  }

  const savedValue = window.localStorage.getItem(key)
  return savedValue && allowedValues.includes(savedValue as T) ? (savedValue as T) : fallback
}

const numberParts = new Intl.NumberFormat('pl-PL', {
  useGrouping: false,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
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

function formatTaskDateTime(task: Pick<Task, 'dueDate' | 'startTime' | 'endTime'>) {
  if (!task.dueDate) {
    return 'bez daty'
  }

  if (task.startTime && task.endTime) {
    return `${task.dueDate}, ${task.startTime}-${task.endTime}`
  }

  if (task.startTime) {
    return `${task.dueDate}, od ${task.startTime}`
  }

  return task.dueDate
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

function costSplitLabel(cost: Cost, settings = defaultSettings) {
  const split = costSplit(cost, settings)
  const primaryName = settings.investors.primary || defaultSettings.investors.primary
  const partnerName = settings.investors.partner || defaultSettings.investors.partner
  const primaryAmount = (cost.amount * split.investorShare) / 100
  const partnerAmount = (cost.amount * split.partnerShare) / 100
  const prefix = cost.status === 'paid' ? 'Zapłacił' : 'Płaci'

  if (split.investorShare === 100 && split.partnerShare === 0) {
    return `${prefix} ${primaryName}: ${formatCurrency(primaryAmount)}`
  }

  if (split.partnerShare === 100 && split.investorShare === 0) {
    return `${prefix} ${partnerName}: ${formatCurrency(partnerAmount)}`
  }

  return `${split.label}: ${primaryName} ${formatCurrency(primaryAmount)}, ${partnerName} ${formatCurrency(partnerAmount)}`
}

const today = new Date().toISOString().slice(0, 10)
const isDevServer = import.meta.env.DEV
const richTextLimit = 50000

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

function calendarHref(token?: string) {
  if (!token) {
    return ''
  }

  const path = isDevServer ? `/api/calendar?token=${encodeURIComponent(token)}` : `api.php?resource=calendar&token=${encodeURIComponent(token)}`
  return new URL(path, window.location.href).toString()
}

function isImageAttachment(attachment: Attachment) {
  return attachment.mimeType.startsWith('image/')
}

function taskPriority(priority: string) {
  return priority === 'Pilne' ? 'Pilne' : 'Normalne'
}

function taskPriorityClass(priority: string) {
  return taskPriority(priority) === 'Pilne' ? ' priority-pilne' : ''
}

function plainTextToHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>')
}

function sanitizeRichTextHtml(html: string) {
  const template = document.createElement('template')
  template.innerHTML = html.slice(0, richTextLimit)
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI'])

  function cleanNode(node: Node): Node {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || '')
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment()
    }

    const element = node as HTMLElement
    const fragment = document.createDocumentFragment()

    if (!allowedTags.has(element.tagName)) {
      element.childNodes.forEach((child) => fragment.append(cleanNode(child)))
      return fragment
    }

    const cleanTag = element.tagName === 'DIV' ? 'P' : element.tagName.toLowerCase()
    const cleanElement = document.createElement(cleanTag)
    element.childNodes.forEach((child) => cleanElement.append(cleanNode(child)))
    return cleanElement
  }

  const wrapper = document.createElement('div')
  template.content.childNodes.forEach((node) => wrapper.append(cleanNode(node)))
  return wrapper.textContent?.trim() ? wrapper.innerHTML : ''
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
  const [activeSection, setActiveSection] = useState<ActiveSection>(() => {
    return readSavedSetting<ActiveSection>(savedActiveSectionKey, 'tasks', ['tasks', 'costs'])
  })
  const [taskView, setTaskView] = useState<TaskView>(() => {
    return readSavedSetting<TaskView>(savedTaskViewKey, 'todo', ['todo', 'done', 'all'])
  })
  const [costView, setCostView] = useState<CostView>(() => {
    return readSavedSetting<CostView>(savedCostViewKey, 'all', ['unpaid', 'paid', 'all'])
  })
  const [activeModal, setActiveModal] = useState<'task' | 'cost' | 'settings' | null>(null)
  const [attachmentPreview, setAttachmentPreview] = useState<Attachment | null>(null)
  const [notePreview, setNotePreview] = useState<NotePreview | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingCostId, setEditingCostId] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<File | undefined>()
  const [taskAttachments, setTaskAttachments] = useState<File[]>([])
  const [taskDropActive, setTaskDropActive] = useState(false)
  const [invoiceDropActive, setInvoiceDropActive] = useState(false)
  const costCommentRef = useRef<HTMLDivElement | null>(null)
  const [taskForm, setTaskForm] = useState({
    title: '',
    area: 'Fundamenty',
    priority: 'Normalne',
    dueDate: today,
    startTime: '09:00',
    endTime: '10:00',
    comment: '',
  })
  const [costForm, setCostForm] = useState({
    title: '',
    area: 'Stan surowy',
    category: 'Materialy',
    amount: '',
    payer: 'me' as CostPayer,
    investorShare: '100',
    investorAmount: '',
    partnerAmount: '',
    commentHtml: '',
    status: 'unpaid' as PaymentStatus,
    paidDate: '',
  })
  const [settingsForm, setSettingsForm] = useState(defaultSettings.investors)

  const settings = state.settings || defaultSettings
  const calendarUrl = calendarHref(settings.calendarToken)

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
    window.localStorage.setItem(savedActiveSectionKey, activeSection)
  }, [activeSection])

  useEffect(() => {
    window.localStorage.setItem(savedTaskViewKey, taskView)
  }, [taskView])

  useEffect(() => {
    window.localStorage.setItem(savedCostViewKey, costView)
  }, [costView])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAttachmentPreview(null)
        setNotePreview(null)
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
      startTime: '09:00',
      endTime: '10:00',
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
      investorAmount: '',
      partnerAmount: '',
      commentHtml: '',
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

  function closeAttachmentPreview() {
    setAttachmentPreview(null)
  }

  function closeCostNotePreview() {
    setNotePreview(null)
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
      priority: taskPriority(task.priority),
      dueDate: task.dueDate,
      startTime: task.startTime || '09:00',
      endTime: task.endTime || '10:00',
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
    const split = costSplit(cost, settings)
    const investorAmount = (cost.amount * split.investorShare) / 100
    const partnerAmount = (cost.amount * split.partnerShare) / 100

    setCostForm({
      title: cost.title,
      area: cost.area || 'Stan surowy',
      category: cost.category,
      amount: String(cost.amount),
      payer: cost.payer || 'me',
      investorShare: String(split.investorShare),
      investorAmount: investorAmount ? String(Math.round(investorAmount)) : '',
      partnerAmount: partnerAmount ? String(Math.round(partnerAmount)) : '',
      commentHtml: sanitizeRichTextHtml(cost.commentHtml || ''),
      status: cost.status,
      paidDate: cost.paidDate,
    })
    setInvoice(undefined)
    setEditingCostId(cost.id)
    setActiveModal('cost')
  }

  function openSettingsModal() {
    setSettingsForm(settings.investors)
    setActiveModal('settings')
  }

  const summary = useMemo(() => {
    const paidCosts = state.costs.filter((cost) => cost.status === 'paid')
    const unpaidCosts = state.costs.filter((cost) => cost.status === 'unpaid')
    const paid = paidCosts.reduce((sum, cost) => sum + cost.amount, 0)
    const unpaid = unpaidCosts.reduce((sum, cost) => sum + cost.amount, 0)

    return {
      total: paid + unpaid,
      paid,
      unpaid,
      unpaidCostCount: unpaidCosts.length,
      paidInvestor: paidCosts.reduce((sum, cost) => {
        return sum + (cost.amount * costSplit(cost, settings).investorShare) / 100
      }, 0),
      paidPartner: paidCosts.reduce((sum, cost) => {
        return sum + (cost.amount * costSplit(cost, settings).partnerShare) / 100
      }, 0),
      todoTasks: state.tasks.filter((task) => task.status === 'todo').length,
      doneTasks: state.tasks.filter((task) => task.status === 'done').length,
    }
  }, [settings, state.costs, state.tasks])

  const filteredTasks = state.tasks.filter((task) => {
    return taskView === 'all' ? true : task.status === taskView
  })

  const filteredCosts = state.costs.filter((cost) => {
    return costView === 'all' ? true : cost.status === costView
  })

  async function runServerAction(action: () => Promise<AppState | Task | Cost>) {
    setError('')

    let result: AppState | Task | Cost
    try {
      result = await action()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie zapisac zmian.')
      return false
    }

    try {
      if ('tasks' in result && 'costs' in result) {
        setState({ ...result, settings: result.settings || settings })
      } else {
        await refreshState()
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie zapisac zmian.')
    }

    return true
  }

  function formatAmountInput(value: number) {
    return Number.isFinite(value) && value > 0 ? formatWithThousands(Math.round(value)) : ''
  }

  function parseAmountInput(value: string | number) {
    const amount = Number(String(value).replace(/\s/g, ''))
    return Number.isFinite(amount) ? amount : 0
  }

  function cleanAmountInput(value: string) {
    const digits = value.replace(/\D/g, '')
    return digits ? formatWithThousands(Number(digits)) : ''
  }

  function setCostPayer(payer: CostPayer) {
    const amount = parseAmountInput(costForm.amount)
    const halfAmount = Number.isFinite(amount) ? amount / 2 : 0
    const nextForm = { ...costForm, payer }

    if (payer === 'me') {
      nextForm.investorShare = '100'
      nextForm.investorAmount = costForm.amount
      nextForm.partnerAmount = ''
    } else if (payer === 'partner') {
      nextForm.investorShare = '0'
      nextForm.investorAmount = ''
      nextForm.partnerAmount = costForm.amount
    } else if (payer === 'half') {
      nextForm.investorShare = '50'
      nextForm.investorAmount = formatAmountInput(halfAmount)
      nextForm.partnerAmount = formatAmountInput(halfAmount)
    }

    setCostForm(nextForm)
  }

  function setCostAmount(amount: string) {
    const formattedAmount = cleanAmountInput(amount)
    const numericAmount = parseAmountInput(formattedAmount)
    const halfAmount = Number.isFinite(numericAmount) ? numericAmount / 2 : 0

    setCostForm((current) => ({
      ...current,
      amount: formattedAmount,
      investorAmount:
        current.payer === 'partner'
          ? ''
          : current.payer === 'half'
            ? formatAmountInput(halfAmount)
            : current.payer === 'custom'
              ? current.investorAmount
              : formattedAmount,
      partnerAmount:
        current.payer === 'me'
          ? ''
          : current.payer === 'half'
            ? formatAmountInput(halfAmount)
            : current.payer === 'custom'
              ? current.partnerAmount
              : formattedAmount,
    }))
  }

  function setInvestorAmount(investorAmount: string) {
    const formattedInvestorAmount = cleanAmountInput(investorAmount)
    setCostForm((current) => {
      if (current.payer === 'half') {
        const amount = parseAmountInput(formattedInvestorAmount)
        return {
          ...current,
          investorAmount: formattedInvestorAmount,
          partnerAmount: formattedInvestorAmount,
          amount: formatAmountInput(Number.isFinite(amount) ? amount * 2 : 0),
        }
      }

      if (current.payer === 'me') {
        return { ...current, investorAmount: formattedInvestorAmount, amount: formattedInvestorAmount }
      }

      const amount = parseAmountInput(formattedInvestorAmount) + parseAmountInput(current.partnerAmount || 0)
      return { ...current, investorAmount: formattedInvestorAmount, amount: formatAmountInput(amount) }
    })
  }

  function setPartnerAmount(partnerAmount: string) {
    const formattedPartnerAmount = cleanAmountInput(partnerAmount)
    setCostForm((current) => {
      if (current.payer === 'partner') {
        return { ...current, partnerAmount: formattedPartnerAmount, amount: formattedPartnerAmount }
      }

      const amount = parseAmountInput(current.investorAmount || 0) + parseAmountInput(formattedPartnerAmount)
      return { ...current, partnerAmount: formattedPartnerAmount, amount: formatAmountInput(amount) }
    })
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
    body.append('startTime', taskForm.startTime)
    body.append('endTime', taskForm.endTime)
    body.append('comment', taskForm.comment)
    taskAttachments.forEach((file) => body.append('attachments[]', file))

    const saved = await runServerAction(() =>
      requestJson<Task | AppState>(apiEndpoint('tasks', editingTaskId || undefined), {
        method: 'POST',
        body,
      }),
    )
    if (saved) {
      resetTaskForm()
      closeModal()
    }
  }

  function toggleTask(id: string) {
    runServerAction(() =>
      requestJson<AppState>(apiEndpoint('tasks', id, 'toggle'), { method: 'PATCH' }),
    )
  }

  function deleteTask(task: Task) {
    if (!window.confirm(`Czy na pewno usunąć zadanie "${task.title}"?`)) {
      return
    }

    runServerAction(() => requestJson<AppState>(apiEndpoint('tasks', task.id), { method: 'DELETE' }))
  }

  function onTaskAttachmentsChange(event: ChangeEvent<HTMLInputElement>) {
    setTaskAttachments(Array.from(event.target.files || []))
  }

  function onInvoiceChange(event: ChangeEvent<HTMLInputElement>) {
    setInvoice(event.target.files?.[0])
  }

  function onTaskAttachmentsDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setTaskDropActive(false)
    setTaskAttachments(Array.from(event.dataTransfer.files).filter((file) => {
      return file.type.startsWith('image/') || file.type === 'application/pdf'
    }))
  }

  function onInvoiceDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setInvoiceDropActive(false)
    setInvoice(Array.from(event.dataTransfer.files).find((file) => {
      return file.type.startsWith('image/') || file.type === 'application/pdf'
    }))
  }

  async function addCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = parseAmountInput(costForm.amount)
    if (!costForm.title.trim() || !Number.isFinite(amount) || amount < 0) {
      return
    }

    const investorAmount = costForm.payer === 'partner' ? 0 : parseAmountInput(costForm.investorAmount || amount)
    const investorShare =
      costForm.payer === 'me'
        ? 100
        : costForm.payer === 'partner'
          ? 0
          : amount > 0
            ? normalizeShare((investorAmount / amount) * 100)
            : normalizeShare(Number(costForm.investorShare))
    const partnerShare = normalizeShare(100 - investorShare)

    const body = new FormData()
    body.append('title', costForm.title)
    body.append('area', costForm.area)
    body.append('category', costForm.category)
    body.append('amount', String(amount))
    body.append('payer', costForm.payer)
    body.append('investorShare', String(investorShare))
    body.append('partnerShare', String(partnerShare))
    body.append('commentHtml', sanitizeRichTextHtml(costCommentRef.current?.innerHTML || costForm.commentHtml))
    body.append('status', costForm.status)
    body.append('paidDate', costForm.paidDate)
    if (invoice) {
      body.append('invoice', invoice)
    }

    const saved = await runServerAction(() =>
      requestJson<Cost | AppState>(apiEndpoint('costs', editingCostId || undefined), {
        method: 'POST',
        body,
      }),
    )
    if (saved) {
      resetCostForm()
      closeModal()
    }
  }

  function toggleCost(id: string) {
    runServerAction(() =>
      requestJson<AppState>(apiEndpoint('costs', id, 'toggle'), { method: 'PATCH' }),
    )
  }

  function deleteCost(cost: Cost) {
    if (!window.confirm(`Czy na pewno usunąć wydatek "${cost.title}"?`)) {
      return
    }

    runServerAction(() => requestJson<AppState>(apiEndpoint('costs', cost.id), { method: 'DELETE' }))
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    try {
      const nextState = await requestJson<AppState>(apiEndpoint('settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investors: settingsForm }),
      })
      setState({ ...nextState, settings: nextState.settings || defaultSettings })
      setSettingsForm((nextState.settings || defaultSettings).investors)
      closeModal()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie zapisac ustawien.')
    }
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
      <main className="app-loading" aria-label="Ładowanie">
        <span />
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
        <div className="hero-actions">
          <button className="hero-icon-button" onClick={openSettingsModal} title="Ustawienia" aria-label="Ustawienia">
            <Settings size={17} />
          </button>
          <button className="logout-button" onClick={logout}>
            <LogOut size={16} />
            Wyloguj
          </button>
        </div>

        <div className="brand">
          <span className="brand-mark">
            <Home size={25} />
          </span>
          <p>Panel inwestora</p>
          <h1>Budowa domu</h1>
        </div>

        <section className="stats-grid" aria-label="Podsumowanie">
          <article className="stat-panel total">
            <span>Budżet wpisany</span>
            <strong>{formatCurrency(summary.total)}</strong>
            <small>Wszystkie wydatki z rejestru</small>
          </article>
          <article className="stat-panel unpaid-summary">
            <span>Do zapłaty</span>
            <strong>{formatCurrency(summary.unpaid)}</strong>
            <small>
              {formatInteger(summary.unpaidCostCount)} pozycji
            </small>
          </article>
          <article className="stat-panel paid-summary">
            <span>Zapłacone</span>
            <strong>{formatCurrency(summary.paid)}</strong>
            <small>
              {formatInteger(state.costs.filter((cost) => cost.status === 'paid').length)} pozycji
            </small>
            <div className="investor-progress" aria-label="Podzial zaplaconych wydatkow">
              <div className="investor-progress-bar">
                <span
                  className="investor-progress-primary"
                  style={{ width: `${summary.paid > 0 ? (summary.paidInvestor / summary.paid) * 100 : 50}%` }}
                />
                <span
                  className="investor-progress-partner"
                  style={{ width: `${summary.paid > 0 ? (summary.paidPartner / summary.paid) * 100 : 50}%` }}
                />
              </div>
              <div className="investor-progress-legend">
                <span>
                  {settings.investors.primary} {formatCurrency(summary.paidInvestor)}
                </span>
                <span>
                  {settings.investors.partner} {formatCurrency(summary.paidPartner)}
                </span>
              </div>
            </div>
          </article>
          <article className="stat-panel task-summary">
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
            {summary.todoTasks > 0 && <span className="tab-count">{formatInteger(summary.todoTasks)}</span>}
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
            {summary.unpaidCostCount > 0 && <span className="tab-count">{formatInteger(summary.unpaidCostCount)}</span>}
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
                <span className="heading-action-label">Dodaj zadanie</span>
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
              <article className={`item-card task-card${taskPriorityClass(task.priority)}`} key={task.id}>
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
                    {taskPriority(task.priority) === 'Pilne' && <span className="badge pilne">Pilne</span>}
                  </div>
                  <p>
                    {task.area} · termin {formatTaskDateTime(task)}
                  </p>
                  {task.attachments && task.attachments.length > 0 && (
                    <div className="attachment-list">
                      {task.attachments.map((attachment) => (
                        isImageAttachment(attachment) ? (
                          <button
                            type="button"
                            className="attachment-thumb"
                            key={attachment.path}
                            title={attachment.name}
                            onClick={() => setAttachmentPreview(attachment)}
                          >
                            <img src={attachmentHref(attachment.path)} alt={attachment.name} loading="lazy" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="attachment-link"
                            key={attachment.path}
                            onClick={() => setAttachmentPreview(attachment)}
                          >
                            <FileText size={16} />
                            {attachment.name}
                          </button>
                        )
                      ))}
                    </div>
                  )}
                </div>
                <div className="item-actions">
                  {task.comment && (
                    <button
                      className="icon-button note-button"
                      onClick={() => setNotePreview({ title: task.title, commentHtml: plainTextToHtml(task.comment || '') })}
                      title="Pokaż komentarz"
                    >
                      <StickyNote size={17} />
                    </button>
                  )}
                  <button
                    className="icon-button edit-button"
                    onClick={() => openEditTaskModal(task)}
                    title="Edytuj zadanie"
                  >
                    <SquarePen size={17} />
                  </button>
                  <button className="icon-button" onClick={() => deleteTask(task)} title="Usun zadanie">
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
                <span className="heading-action-label">Dodaj wydatek</span>
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
                    {costSplitLabel(cost, settings)}
                  </p>
                </div>
                <div className="item-actions">
                  {cost.commentHtml && (
                    <button
                      className="icon-button note-button"
                      onClick={() => setNotePreview({ title: cost.title, commentHtml: cost.commentHtml || '' })}
                      title="Pokaż notatkę"
                    >
                      <StickyNote size={17} />
                    </button>
                  )}
                  {cost.attachment && (
                    <button
                      className="icon-button attachment-button"
                      onClick={() => setAttachmentPreview(cost.attachment || null)}
                      title="Pokaż załącznik"
                    >
                      <Paperclip size={17} />
                    </button>
                  )}
                  <button
                    className="icon-button edit-button"
                    onClick={() => openEditCostModal(cost)}
                    title="Edytuj wydatek"
                  >
                    <SquarePen size={17} />
                  </button>
                  <button className="icon-button" onClick={() => deleteCost(cost)} title="Usun wydatek">
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
                <p>
                  {activeModal === 'task'
                    ? 'Zadania budowy'
                    : activeModal === 'cost'
                      ? 'Wydatki budowy'
                      : 'Konfiguracja'}
                </p>
                <h2 id="modal-title">
                  {activeModal === 'task'
                    ? editingTaskId
                      ? 'Edytuj zadanie'
                      : 'Dodaj zadanie'
                    : activeModal === 'cost'
                      ? editingCostId
                        ? 'Edytuj wydatek'
                        : 'Dodaj wydatek'
                      : 'Ustawienia'}
                </h2>
              </div>
              <button className="modal-close" onClick={closeModal} title="Zamknij">
                <X size={20} />
              </button>
            </div>

            {activeModal === 'settings' ? (
              <form className="entry-form settings-form modal-form" onSubmit={saveSettings}>
                <label>
                  <span>Pierwszy inwestor</span>
                  <input
                    value={settingsForm.primary}
                    onChange={(event) => setSettingsForm({ ...settingsForm, primary: event.target.value })}
                    placeholder="np. Paweł"
                    autoFocus
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
                {calendarUrl && (
                  <label className="wide">
                    <span>Link kalendarza</span>
                    <input value={calendarUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
                  </label>
                )}
                <div className="modal-actions">
                  <button type="button" className="secondary-action" onClick={closeModal}>
                    Anuluj
                  </button>
                  <button type="submit" className="primary-action">
                    <Check size={18} />
                    Zapisz ustawienia
                  </button>
                </div>
              </form>
            ) : activeModal === 'task' ? (
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
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={taskForm.priority === 'Pilne'}
                    onChange={(event) =>
                      setTaskForm({ ...taskForm, priority: event.target.checked ? 'Pilne' : 'Normalne' })
                    }
                  />
                  <span>Pilne</span>
                </label>
                <label>
                  <span>Termin</span>
                  <input
                    type="date"
                    value={taskForm.dueDate}
                    onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value })}
                  />
                </label>
                <div className="time-fields">
                  <label>
                    <span>Początek</span>
                    <input
                      type="time"
                      value={taskForm.startTime}
                      onChange={(event) => setTaskForm({ ...taskForm, startTime: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Koniec</span>
                    <input
                      type="time"
                      value={taskForm.endTime}
                      onChange={(event) => setTaskForm({ ...taskForm, endTime: event.target.value })}
                    />
                  </label>
                </div>
                <label className="wide">
                  <span>Komentarz</span>
                  <textarea
                    value={taskForm.comment}
                    onChange={(event) => setTaskForm({ ...taskForm, comment: event.target.value })}
                    placeholder="np. ustalenia z ekipą, uwagi do odbioru"
                    rows={4}
                  />
                </label>
                <label
                  className={`file-input wide drop-input ${taskDropActive ? 'is-dragging' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setTaskDropActive(true)
                  }}
                  onDragLeave={() => setTaskDropActive(false)}
                  onDrop={onTaskAttachmentsDrop}
                >
                  <span>{editingTaskId ? 'Nowe załączniki' : 'Załączniki'}</span>
                  <input type="file" accept="image/*,.pdf" multiple onChange={onTaskAttachmentsChange} />
                  <em>
                    <Paperclip size={16} />
                    {taskAttachments.length > 0
                      ? taskAttachments.map((file) => file.name).join(', ')
                      : editingTaskId
                        ? 'Zostaw bez zmian albo przeciągnij pliki'
                        : 'Dodaj lub przeciągnij PDF albo zdjęcia'}
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
                    type="text"
                    inputMode="numeric"
                    value={costForm.amount}
                    onChange={(event) => setCostAmount(event.target.value)}
                    placeholder="0"
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
                      setCostPayer(event.target.value as CostPayer)
                    }}
                  >
                    <option value="me">{settings.investors.primary}</option>
                    <option value="partner">{settings.investors.partner}</option>
                    <option value="half">Na pół</option>
                    <option value="custom">Inny podział</option>
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
                <div className="quick-split wide" aria-label="Szybkie ustawienia platnosci">
                  <button type="button" className={costForm.payer === 'me' ? 'active' : ''} onClick={() => setCostPayer('me')}>
                    {settings.investors.primary}
                  </button>
                  <button type="button" className={costForm.payer === 'half' ? 'active' : ''} onClick={() => setCostPayer('half')}>
                    50:50
                  </button>
                  <button type="button" className={costForm.payer === 'partner' ? 'active' : ''} onClick={() => setCostPayer('partner')}>
                    {settings.investors.partner}
                  </button>
                  <button type="button" className={costForm.payer === 'custom' ? 'active' : ''} onClick={() => setCostPayer('custom')}>
                    Inny
                  </button>
                </div>
                {costForm.payer !== 'partner' && (
                  <label>
                    <span>Ile płaci: {settings.investors.primary}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={costForm.investorAmount}
                      onChange={(event) => setInvestorAmount(event.target.value)}
                      placeholder="0"
                    />
                  </label>
                )}
                {costForm.payer !== 'me' && (
                  <label>
                    <span>Ile płaci: {settings.investors.partner}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={costForm.partnerAmount}
                      onChange={(event) => setPartnerAmount(event.target.value)}
                      placeholder="0"
                    />
                  </label>
                )}
                <label className="wide">
                  <span>Notatka</span>
                  <div
                    ref={costCommentRef}
                    className="rich-editor"
                    contentEditable
                    data-empty={!costForm.commentHtml}
                    key={`${editingCostId || 'new'}-cost-comment`}
                    onBlur={(event) => {
                      const commentHtml = sanitizeRichTextHtml(event.currentTarget.innerHTML)
                      event.currentTarget.innerHTML = commentHtml
                      event.currentTarget.dataset.empty = commentHtml ? 'false' : 'true'
                      setCostForm({ ...costForm, commentHtml })
                    }}
                    onInput={(event) => {
                      event.currentTarget.dataset.empty = event.currentTarget.textContent?.trim() ? 'false' : 'true'
                    }}
                    suppressContentEditableWarning
                    dangerouslySetInnerHTML={{ __html: costForm.commentHtml }}
                  />
                </label>
                <label
                  className={`file-input wide drop-input ${invoiceDropActive ? 'is-dragging' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setInvoiceDropActive(true)
                  }}
                  onDragLeave={() => setInvoiceDropActive(false)}
                  onDrop={onInvoiceDrop}
                >
                  <span>{editingCostId ? 'Nowa faktura' : 'Faktura'}</span>
                  <input type="file" accept="image/*,.pdf" onChange={onInvoiceChange} />
                  <em>
                    <Paperclip size={16} />
                    {invoice ? invoice.name : editingCostId ? 'Zostaw bez zmian albo przeciągnij plik' : 'Dodaj lub przeciągnij plik'}
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

      {attachmentPreview && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeAttachmentPreview}>
          <section
            className="modal-panel attachment-preview-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attachment-preview-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p>Załącznik</p>
                <h2 id="attachment-preview-title">{attachmentPreview.name}</h2>
              </div>
              <button className="modal-close" onClick={closeAttachmentPreview} title="Zamknij">
                <X size={20} />
              </button>
            </div>

            <div className="attachment-preview-body">
              {isImageAttachment(attachmentPreview) ? (
                <img src={attachmentHref(attachmentPreview.path)} alt={attachmentPreview.name} />
              ) : (
                <iframe src={attachmentHref(attachmentPreview.path)} title={attachmentPreview.name} />
              )}
            </div>

            <div className="attachment-preview-actions">
              <a href={attachmentHref(attachmentPreview.path)} target="_blank" rel="noreferrer">
                Otwórz w nowej karcie
              </a>
            </div>
          </section>
        </div>
      )}

      {notePreview && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeCostNotePreview}>
          <section
            className="modal-panel note-preview-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-preview-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p>Notatka</p>
                <h2 id="note-preview-title">{notePreview.title}</h2>
              </div>
              <button className="modal-close" onClick={closeCostNotePreview} title="Zamknij">
                <X size={20} />
              </button>
            </div>

            <div
              className="note-preview-body rich-comment"
              dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(notePreview.commentHtml || '') }}
            />
          </section>
        </div>
      )}
    </main>
  )
}

export default App
