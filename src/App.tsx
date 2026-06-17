import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, Dispatch, DragEvent, FormEvent, SetStateAction } from 'react'
import {
  BanknoteArrowDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Home,
  Hourglass,
  Image as ImageIcon,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Plus,
  Settings,
  StickyNote,
  SquarePen,
  Trash,
  Wallet,
  X,
} from 'lucide-react'
import './App.css'

type TaskStatus = 'todo' | 'done'
type PaymentStatus = 'planned' | 'unpaid' | 'paid'
type CostPayer = 'me' | 'partner' | 'half' | 'custom'
type ActiveSection = 'tasks' | 'costs' | 'wallet'
type AuthMode = 'login' | 'register' | 'verify' | 'emailLogin' | 'emailCode'
type TaskView = TaskStatus | 'all'
type CostView = PaymentStatus | 'all'
type FileSetter = Dispatch<SetStateAction<File[]>>

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

type AttachmentGroupPreview = {
  title: string
  label: string
  attachments: Attachment[]
}

type ImageGalleryPreview = {
  title: string
  images: Attachment[]
  index: number
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
  walletTransactionId?: string
  attachment?: Attachment
  attachments?: Attachment[]
}

type WalletTransaction = {
  id: string
  date: string
  description: string
  amount: number
  costId?: string
}

type SettingsState = {
  investors: {
    primary: string
    partner: string
    primaryEmail?: string
    partnerEmail?: string
  }
  calendarToken?: string
}

type AppState = {
  tasks: Task[]
  costs: Cost[]
  wallet?: {
    transactions: WalletTransaction[]
  }
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
    primaryEmail: '',
    partnerEmail: '',
  },
  calendarToken: '',
}

const emptyWallet = { transactions: [] as WalletTransaction[] }
const emptyState: AppState = { tasks: [], costs: [], wallet: emptyWallet, settings: defaultSettings }
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
    return { label: 'Płatność', investorShare: 50, partnerShare: 50 }
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
  const prefix = cost.status === 'paid' ? 'Zapłacił' : cost.status === 'planned' ? 'Planowane' : 'Płaci'

  if (split.investorShare === 100 && split.partnerShare === 0) {
    return `${prefix} ${primaryName}: ${formatCurrency(primaryAmount)}`
  }

  if (split.partnerShare === 100 && split.investorShare === 0) {
    return `${prefix} ${partnerName}: ${formatCurrency(partnerAmount)}`
  }

  return `${cost.status === 'planned' ? 'Planowane' : split.label}: ${primaryName} ${formatCurrency(primaryAmount)}, ${partnerName} ${formatCurrency(partnerAmount)}`
}

function costStatusLabel(cost: Pick<Cost, 'status' | 'paidDate'>) {
  if (cost.status === 'paid') {
    return `zapłacone: ${cost.paidDate || 'bez daty'}`
  }

  return cost.status === 'planned' ? 'planowane' : 'do zapłaty'
}

function costToggleTitle(status: PaymentStatus) {
  if (status === 'paid') {
    return 'Oznacz jako do zapłaty'
  }

  return status === 'planned' ? 'Oznacz jako do zapłaty' : 'Oznacz jako zapłacone'
}

const today = new Date().toISOString().slice(0, 10)
const isDevServer = import.meta.env.DEV
const richTextLimit = 50000

function apiEndpoint(resource: string, id?: string, action?: string) {
  if (isDevServer) {
    if (resource === 'auth') {
      return action ? `/api/auth/${action}` : '/api/auth'
    }

    const suffix = id ? `/${id}${action ? `/${action}` : ''}` : action ? `/${action}` : ''
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

function walletTransactionEndpoint(id?: string) {
  if (isDevServer) {
    return `/api/wallet/transactions${id ? `/${id}` : ''}`
  }

  const params = new URLSearchParams({ resource: 'wallet', action: 'transactions' })
  if (id) {
    params.set('id', id)
  }

  return `api.php?${params.toString()}`
}

function isImageAttachment(attachment: Attachment) {
  return attachment.mimeType.startsWith('image/')
}

function isPdfAttachment(attachment: Attachment) {
  return attachment.mimeType === 'application/pdf' || attachment.name.toLowerCase().endsWith('.pdf')
}

function costAttachments(cost: Cost) {
  const attachments = [...(cost.attachments || [])]
  if (cost.attachment && !attachments.some((attachment) => attachment.path === cost.attachment?.path)) {
    attachments.push(cost.attachment)
  }

  return attachments
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${file.type}`
}

function mergeFiles(current: File[], next: File[]) {
  const existingKeys = new Set(current.map(fileKey))
  return [...current, ...next.filter((file) => !existingKeys.has(fileKey(file)))]
}

function appendFiles(setter: FileSetter, files: File[]) {
  if (files.length === 0) {
    return
  }

  setter((current) => mergeFiles(current, files))
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name)
}

function fileListLabel(files: File[], emptyLabel: string) {
  if (files.length === 0) {
    return emptyLabel
  }

  const visibleNames = files.slice(0, 2).map((file) => file.name).join(', ')
  return files.length > 2 ? `${visibleNames} oraz ${files.length - 2} więcej` : visibleNames
}

async function resizeImageFile(file: File, maxWidth = 1920, maxHeight = 1080) {
  if (!isImageFile(file)) {
    return file
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const element = new Image()
    element.onload = () => {
      URL.revokeObjectURL(url)
      resolve(element)
    }
    element.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Nie udało się przygotować zdjęcia.'))
    }
    element.src = url
  })

  const ratio = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight)
  if (ratio >= 1) {
    return file
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.naturalWidth * ratio)
  canvas.height = Math.round(image.naturalHeight * ratio)
  const context = canvas.getContext('2d')
  if (!context) {
    return file
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const outputType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type : 'image/jpeg'
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, 0.86))
  return blob ? new File([blob], file.name, { type: outputType, lastModified: Date.now() }) : file
}

async function prepareImageFiles(files: File[]) {
  const images = files.filter(isImageFile)
  const prepared = await Promise.allSettled(images.map((file) => resizeImageFile(file)))

  return prepared.map((result, index) => (result.status === 'fulfilled' ? result.value : images[index]))
}

function documentFiles(files: File[]) {
  return files.filter((file) => !isImageFile(file))
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
    return readSavedSetting<ActiveSection>(savedActiveSectionKey, 'tasks', ['tasks', 'costs', 'wallet'])
  })
  const [taskView, setTaskView] = useState<TaskView>(() => {
    return readSavedSetting<TaskView>(savedTaskViewKey, 'todo', ['todo', 'done', 'all'])
  })
  const [costView, setCostView] = useState<CostView>(() => {
    return readSavedSetting<CostView>(savedCostViewKey, 'all', ['planned', 'unpaid', 'paid', 'all'])
  })
  const [activeModal, setActiveModal] = useState<'task' | 'cost' | 'wallet' | 'settings' | null>(null)
  const [attachmentPreview, setAttachmentPreview] = useState<Attachment | null>(null)
  const [attachmentGroupPreview, setAttachmentGroupPreview] = useState<AttachmentGroupPreview | null>(null)
  const [imageGalleryPreview, setImageGalleryPreview] = useState<ImageGalleryPreview | null>(null)
  const [notePreview, setNotePreview] = useState<NotePreview | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingCostId, setEditingCostId] = useState<string | null>(null)
  const [editingWalletTransactionId, setEditingWalletTransactionId] = useState<string | null>(null)
  const [taskDocumentFiles, setTaskDocumentFiles] = useState<File[]>([])
  const [taskImageFiles, setTaskImageFiles] = useState<File[]>([])
  const [costDocumentFiles, setCostDocumentFiles] = useState<File[]>([])
  const [costImageFiles, setCostImageFiles] = useState<File[]>([])
  const [taskRemovePaths, setTaskRemovePaths] = useState<string[]>([])
  const [costRemovePaths, setCostRemovePaths] = useState<string[]>([])
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
    status: 'planned' as PaymentStatus,
    paidDate: '',
    useWallet: false,
  })
  const [walletForm, setWalletForm] = useState({
    date: today,
    description: '',
    amount: '',
  })
  const [settingsForm, setSettingsForm] = useState(defaultSettings.investors)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    newPasswordConfirm: '',
  })

  const settings = state.settings || defaultSettings
  const calendarUrl = calendarHref(settings.calendarToken)

  async function refreshState() {
    setIsLoading(true)
    setError('')

    try {
      const nextState = await requestJson<AppState>(apiEndpoint('state'))
      setState({ ...nextState, wallet: nextState.wallet || emptyWallet, settings: nextState.settings || defaultSettings })
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
        setAttachmentGroupPreview(null)
        setImageGalleryPreview(null)
        setNotePreview(null)
        setActiveModal(null)
        setEditingTaskId(null)
        setEditingCostId(null)
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  useEffect(() => {
    if (!imageGalleryPreview) {
      return undefined
    }

    function navigateGallery(event: KeyboardEvent) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return
      }

      event.preventDefault()
      setImageGalleryPreview((current) => {
        if (!current) {
          return current
        }

        const lastIndex = current.images.length - 1
        if (event.key === 'Home') {
          return { ...current, index: 0 }
        }
        if (event.key === 'End') {
          return { ...current, index: lastIndex }
        }
        if (event.key === 'ArrowLeft') {
          return { ...current, index: current.index === 0 ? lastIndex : current.index - 1 }
        }
        return { ...current, index: current.index === lastIndex ? 0 : current.index + 1 }
      })
    }

    window.addEventListener('keydown', navigateGallery)
    return () => window.removeEventListener('keydown', navigateGallery)
  }, [imageGalleryPreview])

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
    setTaskDocumentFiles([])
    setTaskImageFiles([])
    setTaskRemovePaths([])
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
      status: 'planned',
      paidDate: '',
      useWallet: false,
    })
    setCostDocumentFiles([])
    setCostImageFiles([])
    setCostRemovePaths([])
  }

  function resetWalletForm() {
    setWalletForm({
      date: today,
      description: '',
      amount: '',
    })
  }

  function closeModal() {
    setActiveModal(null)
    setEditingTaskId(null)
    setEditingCostId(null)
    setEditingWalletTransactionId(null)
  }

  function closeAttachmentPreview() {
    setAttachmentPreview(null)
  }

  function openImageGallery(title: string, images: Attachment[], index = 0) {
    setImageGalleryPreview({ title, images, index })
  }

  function closeImageGallery() {
    setImageGalleryPreview(null)
  }

  function moveImageGallery(direction: -1 | 1) {
    setImageGalleryPreview((current) => {
      if (!current) {
        return current
      }

      const lastIndex = current.images.length - 1
      const nextIndex =
        direction === -1
          ? current.index === 0
            ? lastIndex
            : current.index - 1
          : current.index === lastIndex
            ? 0
            : current.index + 1

      return { ...current, index: nextIndex }
    })
  }

  function openAttachmentGroup(title: string, label: string, attachments: Attachment[]) {
    if (attachments.length === 1) {
      setAttachmentPreview(attachments[0])
      return
    }

    setAttachmentGroupPreview({ title, label, attachments })
  }

  function closeAttachmentGroupPreview() {
    setAttachmentGroupPreview(null)
  }

  function closeCostNotePreview() {
    setNotePreview(null)
  }

  function togglePath(paths: string[], path: string) {
    return paths.includes(path) ? paths.filter((current) => current !== path) : [...paths, path]
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
    setTaskDocumentFiles([])
    setTaskImageFiles([])
    setTaskRemovePaths([])
    setEditingTaskId(task.id)
    setActiveModal('task')
  }

  function openNewCostModal() {
    resetCostForm()
    setEditingCostId(null)
    setActiveModal('cost')
  }

  function openWalletModal() {
    resetWalletForm()
    setEditingWalletTransactionId(null)
    setActiveModal('wallet')
  }

  function openEditWalletTransactionModal(transaction: WalletTransaction) {
    setWalletForm({
      date: transaction.date || today,
      description: transaction.description,
      amount: formatAmountInput(Math.abs(transaction.amount)),
    })
    setEditingWalletTransactionId(transaction.id)
    setActiveModal('wallet')
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
      useWallet: Boolean(cost.walletTransactionId),
    })
    setCostDocumentFiles([])
    setCostImageFiles([])
    setCostRemovePaths([])
    setEditingCostId(cost.id)
    setActiveModal('cost')
  }

  function openSettingsModal() {
    setSettingsForm(settings.investors)
    setPasswordForm({ currentPassword: '', newPassword: '', newPasswordConfirm: '' })
    setActiveModal('settings')
  }

  const summary = useMemo(() => {
    const paidCosts = state.costs.filter((cost) => cost.status === 'paid')
    const unpaidCosts = state.costs.filter((cost) => cost.status === 'unpaid')
    const plannedCosts = state.costs.filter((cost) => cost.status === 'planned')
    const paid = paidCosts.reduce((sum, cost) => sum + cost.amount, 0)
    const unpaid = unpaidCosts.reduce((sum, cost) => sum + cost.amount, 0)
    const planned = plannedCosts.reduce((sum, cost) => sum + cost.amount, 0)
    const total = paid + unpaid + planned
    const paidProgress = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
    const walletTransactions = state.wallet?.transactions || []
    const walletBalance = walletTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)

    return {
      total,
      paid,
      paidProgress,
      unpaid,
      unpaidCostCount: unpaidCosts.length,
      walletBalance,
      walletTransactionCount: walletTransactions.length,
      paidInvestor: paidCosts.reduce((sum, cost) => {
        return sum + (cost.amount * costSplit(cost, settings).investorShare) / 100
      }, 0),
      paidPartner: paidCosts.reduce((sum, cost) => {
        return sum + (cost.amount * costSplit(cost, settings).partnerShare) / 100
      }, 0),
      todoTasks: state.tasks.filter((task) => task.status === 'todo').length,
      doneTasks: state.tasks.filter((task) => task.status === 'done').length,
    }
  }, [settings, state.costs, state.tasks, state.wallet])

  const filteredTasks = state.tasks.filter((task) => {
    return taskView === 'all' ? true : task.status === taskView
  })

  const filteredCosts = state.costs.filter((cost) => {
    return costView === 'all' ? true : cost.status === costView
  })
  const editingTask = editingTaskId ? state.tasks.find((task) => task.id === editingTaskId) : undefined
  const editingCost = editingCostId ? state.costs.find((cost) => cost.id === editingCostId) : undefined
  const editingTaskAttachments = (editingTask?.attachments || []).filter((attachment) => !taskRemovePaths.includes(attachment.path))
  const editingCostAttachments = editingCost ? costAttachments(editingCost).filter((attachment) => !costRemovePaths.includes(attachment.path)) : []

  async function runServerAction(action: () => Promise<AppState | Task | Cost | WalletTransaction>) {
    setError('')

    let result: AppState | Task | Cost | WalletTransaction
    try {
      result = await action()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie zapisac zmian.')
      return false
    }

    try {
      if ('tasks' in result && 'costs' in result) {
        setState({ ...result, wallet: result.wallet || emptyWallet, settings: result.settings || settings })
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

  function transactionAmountClass(amount: number) {
    return amount < 0 ? 'wallet-amount-negative' : 'wallet-amount-positive'
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
    body.append('removeAttachments', JSON.stringify(taskRemovePaths))
    taskDocumentFiles.forEach((file) => body.append('documents[]', file))
    taskImageFiles.forEach((file) => body.append('images[]', file))

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

  function onDocumentFilesChange(setter: FileSetter) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      appendFiles(setter, documentFiles(Array.from(event.target.files || [])))
      event.target.value = ''
    }
  }

  function onImageFilesChange(setter: FileSetter) {
    return async (event: ChangeEvent<HTMLInputElement>) => {
      appendFiles(setter, await prepareImageFiles(Array.from(event.target.files || [])))
      event.target.value = ''
    }
  }

  async function onTaskAttachmentsDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setTaskDropActive(false)
    const files = Array.from(event.dataTransfer.files)
    appendFiles(setTaskDocumentFiles, documentFiles(files))
    appendFiles(setTaskImageFiles, await prepareImageFiles(files))
  }

  async function onInvoiceDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setInvoiceDropActive(false)
    const files = Array.from(event.dataTransfer.files)
    appendFiles(setCostDocumentFiles, documentFiles(files))
    appendFiles(setCostImageFiles, await prepareImageFiles(files))
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
    body.append('useWallet', costForm.status === 'paid' && costForm.useWallet ? '1' : '0')
    body.append('removeAttachments', JSON.stringify(costRemovePaths))
    costDocumentFiles.forEach((file) => body.append('documents[]', file))
    costImageFiles.forEach((file) => body.append('images[]', file))

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

  async function saveWalletTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = parseAmountInput(walletForm.amount)
    if (!walletForm.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      return
    }

    const body = new FormData()
    body.append('date', walletForm.date)
    body.append('description', walletForm.description)
    body.append('amount', String(amount))

    const saved = await runServerAction(() =>
      requestJson<WalletTransaction | AppState>(walletTransactionEndpoint(editingWalletTransactionId || undefined), {
        method: 'POST',
        body,
      }),
    )
    if (saved) {
      resetWalletForm()
      setEditingWalletTransactionId(null)
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
      const wantsPasswordChange = Object.values(passwordForm).some((value) => value.trim() !== '')

      if (wantsPasswordChange) {
        if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.newPasswordConfirm) {
          throw new Error('Wypełnij wszystkie pola zmiany hasła albo zostaw je puste.')
        }

        if (passwordForm.newPassword.length < 8) {
          throw new Error('Nowe hasło musi mieć minimum 8 znaków.')
        }

        if (passwordForm.newPassword !== passwordForm.newPasswordConfirm) {
          throw new Error('Nowe hasła nie są takie same.')
        }
      }

      if (wantsPasswordChange) {
        await requestJson(apiEndpoint('auth', undefined, 'change-password'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(passwordForm),
        })
      }

      const nextState = await requestJson<AppState>(apiEndpoint('settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investors: settingsForm }),
      })

      setState({ ...nextState, settings: nextState.settings || defaultSettings })
      setSettingsForm((nextState.settings || defaultSettings).investors)
      setPasswordForm({ currentPassword: '', newPassword: '', newPasswordConfirm: '' })
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

  async function startEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setAuthMessage('')

    try {
      const result = await requestJson<{ message: string; developmentCode?: string }>(
        apiEndpoint('auth', undefined, 'email-login-start'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authForm.email }),
        },
      )
      setAuthMessage(
        result.developmentCode
          ? `${result.message} Kod lokalny: ${result.developmentCode}`
          : result.message,
      )
      setAuthMode('emailCode')
      setAuthForm((current) => ({ ...current, code: '' }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie wyslac kodu.')
    }
  }

  async function verifyEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setAuthMessage('')

    try {
      const result = await requestJson<AuthStatus>(apiEndpoint('auth', undefined, 'email-login-verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authForm.email, code: authForm.code }),
      })
      setAuth({ authenticated: true, setupRequired: false, email: result.email })
      setAuthForm((current) => ({ ...current, password: '', passwordConfirm: '', code: '' }))
      await refreshState()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udalo sie potwierdzic kodu.')
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
            {authMode === 'verify' || authMode === 'emailCode' ? <KeyRound size={24} /> : <Lock size={24} />}
          </span>
          <p>Panel inwestora</p>
          <h1>
            {authMode === 'register'
              ? 'Utwórz pierwsze konto'
              : authMode === 'verify' || authMode === 'emailCode'
                ? 'Wpisz kod z emaila'
                : authMode === 'emailLogin'
                  ? 'Zaloguj kodem email'
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
                    autoComplete="one-time-code"
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

          {authMode === 'emailLogin' && (
            <form className="auth-form" onSubmit={startEmailLogin}>
              <label>
                <span>Adres email inwestora</span>
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
              <button className="primary-action auth-submit" type="submit">
                <Mail size={18} />
                Wyślij kod
              </button>
              <button
                className="secondary-action auth-submit"
                type="button"
                onClick={() => {
                  setError('')
                  setAuthMessage('')
                  setAuthMode('login')
                }}
              >
                Zaloguj hasłem
              </button>
            </form>
          )}

          {authMode === 'emailCode' && (
            <form className="auth-form" onSubmit={verifyEmailLogin}>
              <label>
                <span>Kod logowania</span>
                <div className="auth-input">
                  <KeyRound size={18} />
                  <input
                    inputMode="numeric"
                    value={authForm.code}
                    onChange={(event) => setAuthForm({ ...authForm, code: event.target.value })}
                    placeholder="000000"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                  />
                </div>
              </label>
              <button className="primary-action auth-submit" type="submit">
                <Check size={18} />
                Zaloguj
              </button>
              <button
                className="secondary-action auth-submit"
                type="button"
                onClick={() => {
                  setError('')
                  setAuthMessage('')
                  setAuthMode('emailLogin')
                }}
              >
                Wyślij kod ponownie
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
              <button
                className="secondary-action auth-submit"
                type="button"
                onClick={() => {
                  setError('')
                  setAuthMessage('')
                  setAuthMode('emailLogin')
                }}
              >
                Zaloguj kodem email
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
            <span>Ustawienia</span>
          </button>
          <button className="logout-button" onClick={logout} title="Wyloguj" aria-label="Wyloguj">
            <LogOut size={16} />
            <span>Wyloguj</span>
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
            <span>Planowany koszt inwestycji</span>
            <strong>{formatCurrency(summary.total)}</strong>
            <small>Zapłacone {summary.paidProgress}% planu</small>
            <div
              className="total-progress"
              aria-label={`Zapłacone ${formatCurrency(summary.paid)} z ${formatCurrency(summary.total)}`}
            >
              <span style={{ width: `${summary.paidProgress}%` }} />
            </div>
          </article>
          <article className="stat-panel paid-summary">
            <span>Zapłacone do tej pory</span>
            <strong>{formatCurrency(summary.paid)}</strong>
            <small>
              {formatInteger(state.costs.filter((cost) => cost.status === 'paid').length)} pozycji
            </small>
            <div className="investor-progress" aria-label="Podział zapłaconych wydatków">
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
          <article className="stat-panel unpaid-summary">
            <span>Do zapłaty</span>
            <strong>{formatCurrency(summary.unpaid)}</strong>
            <small>
              {formatInteger(summary.unpaidCostCount)} pozycji
            </small>
          </article>
          <article className="stat-panel wallet-summary">
            <span>Portfel</span>
            <strong>{formatCurrency(summary.walletBalance)}</strong>
            <small>{formatInteger(summary.walletTransactionCount)} transakcji</small>
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
          <button
            className={activeSection === 'wallet' ? 'active' : ''}
            role="tab"
            aria-selected={activeSection === 'wallet'}
            aria-controls="wallet-panel"
            id="wallet-tab"
            onClick={() => setActiveSection('wallet')}
          >
            <Wallet size={18} />
            Portfel
          </button>
        </nav>
      </header>

      <section className="workspace">
        {activeSection === 'tasks' && (
        <section className="module" id="tasks-panel" role="tabpanel" aria-labelledby="tasks-tab">
          <div className="module-heading">
            <div className="module-title">
              <ClipboardList size={24} />
              <div>
                <p>Zadania budowy</p>
                <h2>Do zrobienia i zrobione</h2>
              </div>
            </div>
            <div className="module-actions">
              <button className="heading-action" onClick={openNewTaskModal}>
                <Plus size={18} />
                <span className="heading-action-label">Dodaj zadanie</span>
              </button>
            </div>
          </div>

          <div className="segmented" aria-label="Filtr zadań">
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
            {isLoading ? <p className="empty">Ładuję dane z serwera...</p> : null}
            {!isLoading && filteredTasks.length === 0 ? <p className="empty">Brak zadań w tym widoku.</p> : null}
            {filteredTasks.map((task) => {
              const attachments = task.attachments || []
              const imageAttachments = attachments.filter(isImageAttachment)
              const documentAttachments = attachments.filter((attachment) => !isImageAttachment(attachment))
              const documentLabel = documentAttachments.every(isPdfAttachment) ? 'PDF' : 'Dokumenty'

              return (
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
                    {imageAttachments.length > 0 && (
                      <button
                        className="icon-button attachment-button attachment-group-button"
                        onClick={() => openImageGallery(task.title, imageAttachments)}
                        title={`Pokaż obrazy (${imageAttachments.length})`}
                      >
                        <ImageIcon size={17} />
                        {imageAttachments.length > 1 && <span className="attachment-count">{imageAttachments.length}</span>}
                      </button>
                    )}
                    {documentAttachments.length > 0 && (
                      <button
                        className="icon-button attachment-button attachment-group-button"
                        onClick={() => openAttachmentGroup(task.title, documentLabel, documentAttachments)}
                        title={`Pokaż ${documentLabel.toLowerCase()} (${documentAttachments.length})`}
                      >
                        <FileText size={17} />
                        {documentAttachments.length > 1 && <span className="attachment-count">{documentAttachments.length}</span>}
                      </button>
                    )}
                    <button
                      className="icon-button edit-button"
                      onClick={() => openEditTaskModal(task)}
                      title="Edytuj zadanie"
                    >
                      <SquarePen size={17} />
                    </button>
                    <button className="icon-button" onClick={() => deleteTask(task)} title="Usuń zadanie">
                      <Trash size={18} />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
        )}

        {activeSection === 'costs' && (
        <section className="module" id="costs-panel" role="tabpanel" aria-labelledby="costs-tab">
          <div className="module-heading">
            <div className="module-title">
              <BanknoteArrowDown size={24} />
              <div>
                <p>Wydatki budowy</p>
                <h2>Faktury, płatności</h2>
              </div>
            </div>
            <div className="module-actions">
              <button className="heading-action" onClick={openNewCostModal}>
                <Plus size={18} />
                <span className="heading-action-label">Dodaj wydatek</span>
              </button>
            </div>
          </div>

          <div className="segmented" aria-label="Filtr wydatków">
            <button
              className={costView === 'planned' ? 'active' : ''}
              onClick={() => setCostView('planned')}
            >
              Planowane
            </button>
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
            {isLoading ? <p className="empty">Ładuję wydatki z serwera...</p> : null}
            {!isLoading && filteredCosts.length === 0 ? <p className="empty">Brak wydatków w tym widoku.</p> : null}
            {filteredCosts.map((cost) => {
                const attachments = costAttachments(cost)
                const imageAttachments = attachments.filter(isImageAttachment)
                const documentAttachments = attachments.filter((attachment) => !isImageAttachment(attachment))
                const documentLabel = documentAttachments.every(isPdfAttachment) ? 'PDF' : 'Dokumenty'

                return (
                  <article className="item-card cost-card" key={cost.id}>
                    <button
                      className={`status-dot ${cost.status}`}
                      onClick={() => toggleCost(cost.id)}
                      title={costToggleTitle(cost.status)}
                    >
                      {cost.status === 'planned' && <Hourglass size={15} />}
                      {cost.status === 'paid' && <Check size={16} />}
                    </button>
                    <div className="item-main">
                      <div className="item-title-row">
                        <h3>{cost.title}</h3>
                        <strong className="amount-badge">{formatCurrency(cost.amount)}</strong>
                      </div>
                      <p>{cost.area || 'Fundamenty'} · {cost.category}</p>
                      <p>{costStatusLabel(cost)}</p>
                      <p className="cost-split">
                        {costSplitLabel(cost, settings)}
                      </p>
                    </div>
                    <div className="item-actions">
                      <strong className="amount-badge amount-badge-mobile">{formatCurrency(cost.amount)}</strong>
                      {cost.commentHtml && (
                        <button
                          className="icon-button note-button"
                          onClick={() => setNotePreview({ title: cost.title, commentHtml: cost.commentHtml || '' })}
                          title="Pokaż notatkę"
                        >
                          <StickyNote size={17} />
                        </button>
                      )}
                      {imageAttachments.length > 0 && (
                        <button
                          className="icon-button attachment-button attachment-group-button"
                          onClick={() => openImageGallery(cost.title, imageAttachments)}
                          title={`Pokaż obrazy (${imageAttachments.length})`}
                        >
                          <ImageIcon size={17} />
                          {imageAttachments.length > 1 && <span className="attachment-count">{imageAttachments.length}</span>}
                        </button>
                      )}
                      {documentAttachments.length > 0 && (
                        <button
                          className="icon-button attachment-button attachment-group-button"
                          onClick={() => openAttachmentGroup(cost.title, documentLabel, documentAttachments)}
                          title={`Pokaż ${documentLabel.toLowerCase()} (${documentAttachments.length})`}
                        >
                          <FileText size={17} />
                          {documentAttachments.length > 1 && <span className="attachment-count">{documentAttachments.length}</span>}
                        </button>
                      )}
                      <button
                        className="icon-button edit-button"
                        onClick={() => openEditCostModal(cost)}
                        title="Edytuj wydatek"
                      >
                        <SquarePen size={17} />
                      </button>
                      <button className="icon-button" onClick={() => deleteCost(cost)} title="Usuń wydatek">
                        <Trash size={18} />
                      </button>
                    </div>
                  </article>
                )
              })}
          </div>
        </section>
        )}

        {activeSection === 'wallet' && (
        <section className="module" id="wallet-panel" role="tabpanel" aria-labelledby="wallet-tab">
          <div className="module-heading">
            <div className="module-title">
              <Wallet size={24} />
              <div>
                <p>Portfel inwestycji</p>
                <h2>Środki odłożone na koncie</h2>
              </div>
            </div>
            <div className="module-actions">
              <button className="heading-action" onClick={openWalletModal}>
                <Plus size={18} />
                <span className="heading-action-label">Dodaj środki</span>
              </button>
            </div>
          </div>

          <div className="wallet-balance-strip">
            <span>Saldo Portfela</span>
            <strong>{formatCurrency(summary.walletBalance)}</strong>
          </div>

          <div className="list">
            {isLoading ? <p className="empty">Ładuję historię Portfela...</p> : null}
            {!isLoading && (state.wallet?.transactions || []).length === 0 ? (
              <p className="empty">Brak transakcji w Portfelu.</p>
            ) : null}
            {(state.wallet?.transactions || []).map((transaction) => (
              <article className="item-card wallet-card" key={transaction.id}>
                <div className="item-main">
                  <div className="item-title-row">
                    <h3>{transaction.description}</h3>
                    <strong className={`wallet-amount ${transactionAmountClass(transaction.amount)}`}>
                      {transaction.amount < 0 ? '-' : '+'}
                      {formatCurrency(Math.abs(transaction.amount))}
                    </strong>
                  </div>
                  <p>{transaction.date || 'bez daty'}</p>
                </div>
                <div className="item-actions">
                  <button
                    className="icon-button edit-button"
                    onClick={() => openEditWalletTransactionModal(transaction)}
                    title="Edytuj operację"
                  >
                    <SquarePen size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        )}
      </section>

      <footer className="app-footer">
        <a href="https://github.com/hejsiri/budowa-domu" target="_blank" rel="noreferrer">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M12 .5a12 12 0 0 0-3.8 23.39c.6.11.82-.26.82-.58v-2.22c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z"
            />
          </svg>
          Zobacz projekt na GitHubie
        </a>
      </footer>

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
                      : activeModal === 'wallet'
                        ? 'Portfel inwestycji'
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
                      : activeModal === 'wallet'
                        ? editingWalletTransactionId
                          ? 'Edytuj operację'
                          : 'Dodaj środki'
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
                  <span>Email pierwszego inwestora</span>
                  <input
                    type="email"
                    value={settingsForm.primaryEmail || ''}
                    onChange={(event) => setSettingsForm({ ...settingsForm, primaryEmail: event.target.value })}
                    placeholder="np. pawel@example.com"
                    autoComplete="email"
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
                <label>
                  <span>Email drugiego inwestora</span>
                  <input
                    type="email"
                    value={settingsForm.partnerEmail || ''}
                    onChange={(event) => setSettingsForm({ ...settingsForm, partnerEmail: event.target.value })}
                    placeholder="np. anna@example.com"
                    autoComplete="email"
                  />
                </label>
                {calendarUrl && (
                  <label className="wide">
                    <span>Link kalendarza</span>
                    <input value={calendarUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
                  </label>
                )}
                <div className="settings-section wide">
                  <p>Zmiana hasła</p>
                </div>
                <label>
                  <span>Aktualne hasło</span>
                  <input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  <span>Nowe hasło</span>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
                    autoComplete="new-password"
                    minLength={8}
                  />
                </label>
                <label className="wide">
                  <span>Powtórz nowe hasło</span>
                  <input
                    type="password"
                    value={passwordForm.newPasswordConfirm}
                    onChange={(event) => setPasswordForm({ ...passwordForm, newPasswordConfirm: event.target.value })}
                    autoComplete="new-password"
                    minLength={8}
                  />
                </label>
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
            ) : activeModal === 'wallet' ? (
              <form className="entry-form modal-form" onSubmit={saveWalletTransaction}>
                <label>
                  <span>Data</span>
                  <input
                    type="date"
                    value={walletForm.date}
                    onChange={(event) => setWalletForm({ ...walletForm, date: event.target.value })}
                    autoFocus
                  />
                </label>
                <label>
                  <span>Kwota PLN</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={walletForm.amount}
                    onChange={(event) => setWalletForm({ ...walletForm, amount: cleanAmountInput(event.target.value) })}
                    placeholder="0"
                  />
                </label>
                <label className="wide">
                  <span>Opis transakcji</span>
                  <input
                    value={walletForm.description}
                    onChange={(event) => setWalletForm({ ...walletForm, description: event.target.value })}
                    placeholder="np. Przelew na konto inwestycyjne"
                  />
                </label>
                <div className="modal-actions">
                  <button type="button" className="secondary-action" onClick={closeModal}>
                    Anuluj
                  </button>
                  <button type="submit" className="primary-action">
                    {editingWalletTransactionId ? <Check size={18} /> : <Plus size={18} />}
                    {editingWalletTransactionId ? 'Zapisz zmiany' : 'Dodaj środki'}
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
                {editingTaskId && editingTaskAttachments.length > 0 && (
                  <div className="attachment-edit-list wide">
                    <span>Obecne załączniki</span>
                    {editingTaskAttachments.map((attachment) => (
                      <div className="attachment-edit-row" key={attachment.path}>
                        {isImageAttachment(attachment) ? <ImageIcon size={16} /> : <FileText size={16} />}
                        <button type="button" onClick={() => setAttachmentPreview(attachment)}>
                          {attachment.name}
                        </button>
                        <button
                          type="button"
                          className="attachment-remove"
                          onClick={() => setTaskRemovePaths((paths) => togglePath(paths, attachment.path))}
                        >
                          Usuń
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label
                  className={`file-input wide drop-input ${taskDropActive ? 'is-dragging' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setTaskDropActive(true)
                  }}
                  onDragLeave={() => setTaskDropActive(false)}
                  onDrop={onTaskAttachmentsDrop}
                >
                  <span>{editingTaskId ? 'Nowe dokumenty' : 'Dokumenty'}</span>
                  <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf" multiple onChange={onDocumentFilesChange(setTaskDocumentFiles)} />
                  <em>
                    <FileText size={16} />
                    {fileListLabel(taskDocumentFiles, editingTaskId ? 'Dodaj lub przeciągnij dokumenty' : 'Dodaj dokumenty')}
                  </em>
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
                  <span>{editingTaskId ? 'Nowe zdjęcia' : 'Zdjęcia'}</span>
                  <input type="file" accept="image/*" multiple onChange={onImageFilesChange(setTaskImageFiles)} />
                  <em>
                    <ImageIcon size={16} />
                    {fileListLabel(taskImageFiles, editingTaskId ? 'Dodaj lub przeciągnij zdjęcia' : 'Dodaj zdjęcia')}
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
                    <option value="planned">Planowane</option>
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
                  <span>Kiedy zapłacono</span>
                  <input
                    type="date"
                    value={costForm.paidDate}
                    disabled={costForm.status !== 'paid'}
                    onChange={(event) => setCostForm({ ...costForm, paidDate: event.target.value })}
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={costForm.useWallet}
                    disabled={costForm.status !== 'paid'}
                    onChange={(event) => setCostForm({ ...costForm, useWallet: event.target.checked })}
                  />
                  <span>Pobierz środki z Portfela</span>
                </label>
                <div className="quick-split wide" aria-label="Szybkie ustawienia płatności">
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
                {editingCostId && editingCostAttachments.length > 0 && (
                  <div className="attachment-edit-list wide">
                    <span>Obecne załączniki</span>
                    {editingCostAttachments.map((attachment) => (
                      <div className="attachment-edit-row" key={attachment.path}>
                        {isImageAttachment(attachment) ? <ImageIcon size={16} /> : <FileText size={16} />}
                        <button type="button" onClick={() => setAttachmentPreview(attachment)}>
                          {attachment.name}
                        </button>
                        <button
                          type="button"
                          className="attachment-remove"
                          onClick={() => setCostRemovePaths((paths) => togglePath(paths, attachment.path))}
                        >
                          Usuń
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label
                  className={`file-input wide drop-input ${invoiceDropActive ? 'is-dragging' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setInvoiceDropActive(true)
                  }}
                  onDragLeave={() => setInvoiceDropActive(false)}
                  onDrop={onInvoiceDrop}
                >
                  <span>{editingCostId ? 'Nowe dokumenty' : 'Nowy dokument'}</span>
                  <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf" multiple onChange={onDocumentFilesChange(setCostDocumentFiles)} />
                  <em>
                    <FileText size={16} />
                    {fileListLabel(costDocumentFiles, editingCostId ? 'Dodaj lub przeciągnij dokumenty' : 'Dodaj dokumenty')}
                  </em>
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
                  <span>{editingCostId ? 'Nowe zdjęcia' : 'Zdjęcia'}</span>
                  <input type="file" accept="image/*" multiple onChange={onImageFilesChange(setCostImageFiles)} />
                  <em>
                    <ImageIcon size={16} />
                    {fileListLabel(costImageFiles, editingCostId ? 'Dodaj lub przeciągnij zdjęcia' : 'Dodaj zdjęcia')}
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

      {attachmentGroupPreview && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeAttachmentGroupPreview}>
          <section
            className="modal-panel attachment-group-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attachment-group-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p>{attachmentGroupPreview.label}</p>
                <h2 id="attachment-group-title">{attachmentGroupPreview.title}</h2>
              </div>
              <button className="modal-close" onClick={closeAttachmentGroupPreview} title="Zamknij">
                <X size={20} />
              </button>
            </div>

            <div className="attachment-choice-list">
              {attachmentGroupPreview.attachments.map((attachment) => (
                <button
                  type="button"
                  className="attachment-choice"
                  key={attachment.path}
                  onClick={() => {
                    setAttachmentGroupPreview(null)
                    setAttachmentPreview(attachment)
                  }}
                >
                  {isImageAttachment(attachment) ? <ImageIcon size={18} /> : <FileText size={18} />}
                  <span>{attachment.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {imageGalleryPreview && (
        <div className="modal-backdrop image-gallery-backdrop" role="presentation" onMouseDown={closeImageGallery}>
          <section
            className="modal-panel image-gallery-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Przeglądarka zdjęć"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="image-gallery-close" onClick={closeImageGallery} title="Zamknij">
              <X size={24} />
            </button>

            <div className="image-gallery-body">
              {imageGalleryPreview.images.length > 1 && (
                <button
                  type="button"
                  className="gallery-nav gallery-nav-prev"
                  onClick={() => moveImageGallery(-1)}
                  title="Poprzednie zdjęcie"
                >
                  <ChevronLeft size={28} />
                </button>
              )}

              <img
                src={attachmentHref(imageGalleryPreview.images[imageGalleryPreview.index].path)}
                alt={imageGalleryPreview.images[imageGalleryPreview.index].name}
              />

              {imageGalleryPreview.images.length > 1 && (
                <button
                  type="button"
                  className="gallery-nav gallery-nav-next"
                  onClick={() => moveImageGallery(1)}
                  title="Następne zdjęcie"
                >
                  <ChevronRight size={28} />
                </button>
              )}
            </div>

            {imageGalleryPreview.images.length > 1 && (
              <div className="image-gallery-thumbs" aria-label="Miniatury zdjęć">
                {imageGalleryPreview.images.map((image, index) => (
                  <button
                    type="button"
                    className={index === imageGalleryPreview.index ? 'active' : ''}
                    key={image.path}
                    onClick={() => setImageGalleryPreview({ ...imageGalleryPreview, index })}
                    title={image.name}
                  >
                    <img src={attachmentHref(image.path)} alt="" />
                  </button>
                ))}
              </div>
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
