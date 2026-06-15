import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import multer from 'multer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const storageDir = path.join(rootDir, 'storage')
const uploadsDir = path.join(rootDir, 'uploads')
const dataFile = path.join(storageDir, 'budowa.json')
const usersFile = path.join(storageDir, 'users.json')
const sessionsFile = path.join(storageDir, 'sessions.json')
const legacyDataFile = path.join(__dirname, 'data', 'budowa.json')
const exampleDataFile = path.join(__dirname, 'data', 'budowa.example.json')
const sessionCookieName = 'budowa_session'
const port = Number(process.env.PORT || 4174)

const initialState = {
  tasks: [
    {
      id: randomUUID(),
      title: 'Zamowic kierownika budowy na odbior zbrojenia',
      area: 'Stan surowy',
      priority: 'Pilne',
      dueDate: '2026-06-18',
      comment: '',
      attachments: [],
      status: 'todo',
    },
    {
      id: randomUUID(),
      title: 'Sprawdzic wycene bloczkow i transportu',
      area: 'Materialy',
      priority: 'Normalne',
      dueDate: '2026-06-21',
      comment: '',
      attachments: [],
      status: 'todo',
    },
    {
      id: randomUUID(),
      title: 'Zapisac pomiar geodety do dokumentow',
      area: 'Dokumenty',
      priority: 'Normalne',
      dueDate: '2026-06-10',
      comment: '',
      attachments: [],
      status: 'done',
    },
  ],
  costs: [
    {
      id: randomUUID(),
      title: 'Mapa do celow projektowych',
      area: 'Dokumenty',
      category: 'Dokumenty',
      amount: 850,
      status: 'paid',
      paidDate: '2026-06-05',
    },
    {
      id: randomUUID(),
      title: 'Zaliczka za stal zbrojeniowa',
      area: 'Fundamenty',
      category: 'Materialy',
      amount: 6400,
      status: 'unpaid',
      paidDate: '',
    },
  ],
}

const storage = multer.diskStorage({
  destination: async (_request, _file, callback) => {
    await fs.mkdir(uploadsDir, { recursive: true })
    callback(null, uploadsDir)
  },
  filename: (_request, file, callback) => {
    const ext = path.extname(file.originalname)
    const base = path
      .basename(file.originalname, ext)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)

    callback(null, `${Date.now()}-${base || 'faktura'}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
})

async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true })
  await fs.mkdir(uploadsDir, { recursive: true })

  try {
    await fs.access(dataFile)
  } catch {
    try {
      await fs.copyFile(legacyDataFile, dataFile)
    } catch {
      try {
        await fs.copyFile(exampleDataFile, dataFile)
      } catch {
        await writeState(initialState)
      }
    }
  }
}

async function readState() {
  await ensureStorage()
  const content = await fs.readFile(dataFile, 'utf8')
  return JSON.parse(content)
}

async function writeState(state) {
  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(dataFile, JSON.stringify(state, null, 2))
}

function cleanText(value, fallback = '') {
  return String(value || fallback).trim()
}

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

function fileAttachment(file) {
  return {
    name: file.originalname,
    path: `/uploads/${file.filename}`,
    mimeType: file.mimetype,
  }
}

async function deleteAttachments(attachments = []) {
  await Promise.all(
    attachments
      .filter((attachment) => attachment?.path)
      .map((attachment) =>
        fs.rm(path.join(rootDir, attachment.path.replace(/^\//, '')), { force: true }).catch(() => undefined),
      ),
  )
}

async function readStorageFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeStorageFile(file, payload) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(payload, null, 2))
}

async function getUsers() {
  const store = await readStorageFile(usersFile, { users: [], pendingRegistration: null })
  return {
    users: Array.isArray(store.users) ? store.users : [],
    pendingRegistration: store.pendingRegistration || null,
  }
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function hashSecret(secret) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(secret, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifySecret(secret, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':')
  if (!salt || !hash) {
    return false
  }

  const stored = Buffer.from(hash, 'hex')
  const current = scryptSync(secret, salt, 64)
  return stored.length === current.length && timingSafeEqual(stored, current)
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((entry) => entry.trim().split('='))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  )
}

function setSessionCookie(response, token, maxAgeSeconds) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]

  response.setHeader('Set-Cookie', parts.join('; '))
}

async function createSession(response, email) {
  const token = randomBytes(32).toString('hex')
  const sessions = await readStorageFile(sessionsFile, { sessions: [] })
  sessions.sessions = (sessions.sessions || []).filter((session) => Number(session.expiresAt) > Date.now())
  sessions.sessions.push({
    tokenHash: hashSecret(token),
    email,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14,
  })

  await writeStorageFile(sessionsFile, sessions)
  setSessionCookie(response, token, 60 * 60 * 24 * 14)
}

async function getCurrentUser(request) {
  const token = parseCookies(request.headers.cookie)[sessionCookieName]
  if (!token) {
    return null
  }

  const sessions = await readStorageFile(sessionsFile, { sessions: [] })
  const session = (sessions.sessions || []).find(
    (item) => Number(item.expiresAt) > Date.now() && verifySecret(token, item.tokenHash),
  )

  return session ? { email: session.email } : null
}

async function clearSession(request, response) {
  const token = parseCookies(request.headers.cookie)[sessionCookieName]
  if (token) {
    const sessions = await readStorageFile(sessionsFile, { sessions: [] })
    sessions.sessions = (sessions.sessions || []).filter((session) => !verifySecret(token, session.tokenHash))
    await writeStorageFile(sessionsFile, sessions)
  }

  setSessionCookie(response, '', 0)
}

async function requireAuth(request, response, next) {
  try {
    const user = await getCurrentUser(request)
    if (!user) {
      response.status(401).json({ message: 'Sesja wygasla. Zaloguj sie ponownie.' })
      return
    }

    request.user = user
    next()
  } catch (error) {
    next(error)
  }
}

const app = express()
app.use(express.json())
app.use('/uploads', express.static(uploadsDir))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/auth', async (request, response, next) => {
  try {
    const store = await getUsers()
    const user = await getCurrentUser(request)
    response.json({
      authenticated: user !== null,
      setupRequired: store.users.length === 0,
      email: user?.email || '',
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/register-start', async (request, response, next) => {
  try {
    const store = await getUsers()
    if (store.users.length > 0) {
      response.status(403).json({ message: 'Rejestracja jest juz zablokowana.' })
      return
    }

    const email = cleanEmail(request.body.email)
    const password = String(request.body.password || '')
    const passwordConfirm = String(request.body.passwordConfirm || '')

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      response.status(400).json({ message: 'Podaj poprawny adres email.' })
      return
    }

    if (password.length < 8 || password !== passwordConfirm) {
      response.status(400).json({ message: 'Hasla musza byc takie same i miec minimum 8 znakow.' })
      return
    }

    const code = generateCode()
    store.pendingRegistration = {
      email,
      passwordHash: hashSecret(password),
      codeHash: hashSecret(code),
      expiresAt: Date.now() + 1000 * 60 * 5,
    }
    await writeStorageFile(usersFile, store)

    console.log(`Kod weryfikacyjny Budowa domu dla ${email}: ${code}`)
    response.json({
      message: 'Wyslano kod weryfikacyjny.',
      developmentCode: process.env.NODE_ENV === 'production' ? undefined : code,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/register-verify', async (request, response, next) => {
  try {
    const store = await getUsers()
    if (store.users.length > 0) {
      response.status(403).json({ message: 'Rejestracja jest juz zablokowana.' })
      return
    }

    const pending = store.pendingRegistration
    const code = String(request.body.code || '').trim()

    if (!pending || Number(pending.expiresAt) < Date.now()) {
      response.status(400).json({ message: 'Kod wygasl. Wyslij formularz rejestracji ponownie.' })
      return
    }

    if (!verifySecret(code, pending.codeHash)) {
      response.status(400).json({ message: 'Niepoprawny kod weryfikacyjny.' })
      return
    }

    store.users = [
      {
        id: randomUUID(),
        email: pending.email,
        passwordHash: pending.passwordHash,
        createdAt: new Date().toISOString(),
      },
    ]
    store.pendingRegistration = null
    await writeStorageFile(usersFile, store)
    response.json({ message: 'Konto zostalo utworzone. Mozesz sie zalogowac.' })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const store = await getUsers()
    const email = cleanEmail(request.body.email)
    const password = String(request.body.password || '')
    const user = store.users.find((item) => item.email === email)

    if (!user || !verifySecret(password, user.passwordHash)) {
      response.status(401).json({ message: 'Niepoprawny email lub haslo.' })
      return
    }

    await createSession(response, email)
    response.json({ authenticated: true, email })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/logout', async (request, response, next) => {
  try {
    await clearSession(request, response)
    response.json({ authenticated: false })
  } catch (error) {
    next(error)
  }
})

app.use('/api', requireAuth)

app.get('/api/state', async (_request, response, next) => {
  try {
    response.json(await readState())
  } catch (error) {
    next(error)
  }
})

app.post('/api/tasks', upload.array('attachments[]', 8), async (request, response, next) => {
  try {
    const state = await readState()
    const task = {
      id: randomUUID(),
      title: cleanText(request.body.title),
      area: cleanText(request.body.area, 'Stan surowy'),
      priority: cleanText(request.body.priority, 'Normalne'),
      dueDate: cleanText(request.body.dueDate),
      comment: cleanText(request.body.comment),
      attachments: (request.files || []).map(fileAttachment),
      status: 'todo',
    }

    if (!task.title) {
      response.status(400).json({ message: 'Brakuje nazwy zadania.' })
      return
    }

    state.tasks = [task, ...state.tasks]
    await writeState(state)
    response.status(201).json(task)
  } catch (error) {
    next(error)
  }
})

app.post('/api/tasks/:id', upload.array('attachments[]', 8), async (request, response, next) => {
  try {
    const state = await readState()
    const attachments = (request.files || []).map(fileAttachment)
    let updatedTask = null

    state.tasks = state.tasks.map((task) => {
      if (task.id !== request.params.id) {
        return task
      }

      updatedTask = {
        ...task,
        title: cleanText(request.body.title),
        area: cleanText(request.body.area, 'Stan surowy'),
        priority: cleanText(request.body.priority, 'Normalne'),
        dueDate: cleanText(request.body.dueDate),
        comment: cleanText(request.body.comment),
        attachments: [...(task.attachments || []), ...attachments],
      }

      return updatedTask
    })

    if (!updatedTask?.title) {
      response.status(400).json({ message: 'Brakuje nazwy zadania.' })
      return
    }

    await writeState(state)
    response.json(state)
  } catch (error) {
    next(error)
  }
})

app.patch('/api/tasks/:id/toggle', async (request, response, next) => {
  try {
    const state = await readState()
    state.tasks = state.tasks.map((task) =>
      task.id === request.params.id
        ? { ...task, status: task.status === 'todo' ? 'done' : 'todo' }
        : task,
    )
    await writeState(state)
    response.json(state)
  } catch (error) {
    next(error)
  }
})

app.patch('/api/tasks/:id', async (request, response, next) => {
  try {
    const state = await readState()
    let updatedTask = null

    state.tasks = state.tasks.map((task) => {
      if (task.id !== request.params.id) {
        return task
      }

      updatedTask = {
        ...task,
        title: cleanText(request.body.title),
        area: cleanText(request.body.area, 'Stan surowy'),
        priority: cleanText(request.body.priority, 'Normalne'),
        dueDate: cleanText(request.body.dueDate),
        comment: cleanText(request.body.comment),
      }

      return updatedTask
    })

    if (!updatedTask?.title) {
      response.status(400).json({ message: 'Brakuje nazwy zadania.' })
      return
    }

    await writeState(state)
    response.json(state)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/tasks/:id', async (request, response, next) => {
  try {
    const state = await readState()
    const task = state.tasks.find((item) => item.id === request.params.id)
    state.tasks = state.tasks.filter((task) => task.id !== request.params.id)
    await writeState(state)
    await deleteAttachments(task?.attachments)
    response.json(state)
  } catch (error) {
    next(error)
  }
})

app.post('/api/costs', upload.single('invoice'), async (request, response, next) => {
  try {
    const state = await readState()
    const amount = Number(request.body.amount)
    const status = request.body.status === 'paid' ? 'paid' : 'unpaid'
    const cost = {
      id: randomUUID(),
      title: cleanText(request.body.title),
      area: cleanText(request.body.area, 'Inne'),
      category: cleanText(request.body.category, 'Inne'),
      amount,
      status,
      paidDate: status === 'paid' ? cleanText(request.body.paidDate, getToday()) : '',
      attachment: request.file
        ? {
            name: request.file.originalname,
            path: `/uploads/${request.file.filename}`,
            mimeType: request.file.mimetype,
          }
        : undefined,
    }

    if (!cost.title || !Number.isFinite(cost.amount) || cost.amount <= 0) {
      response.status(400).json({ message: 'Podaj opis i prawidlowa kwote kosztu.' })
      return
    }

    state.costs = [cost, ...state.costs]
    await writeState(state)
    response.status(201).json(cost)
  } catch (error) {
    next(error)
  }
})

async function updateCost(request, response, next) {
  try {
    const state = await readState()
    const amount = Number(request.body.amount)
    const status = request.body.status === 'paid' ? 'paid' : 'unpaid'
    let previousAttachment
    let updatedCost = null

    state.costs = state.costs.map((cost) => {
      if (cost.id !== request.params.id) {
        return cost
      }

      previousAttachment = cost.attachment
      updatedCost = {
        ...cost,
        title: cleanText(request.body.title),
        area: cleanText(request.body.area, 'Inne'),
        category: cleanText(request.body.category, 'Inne'),
        amount,
        status,
        paidDate: status === 'paid' ? cleanText(request.body.paidDate, getToday()) : '',
      }

      if (request.file) {
        updatedCost.attachment = {
          name: request.file.originalname,
          path: `/uploads/${request.file.filename}`,
          mimeType: request.file.mimetype,
        }
      }

      return updatedCost
    })

    if (!updatedCost?.title || !Number.isFinite(updatedCost.amount) || updatedCost.amount <= 0) {
      response.status(400).json({ message: 'Podaj opis i prawidlowa kwote kosztu.' })
      return
    }

    await writeState(state)

    if (request.file && previousAttachment?.path) {
      const invoicePath = path.join(rootDir, previousAttachment.path.replace(/^\//, ''))
      await fs.rm(invoicePath, { force: true }).catch(() => undefined)
    }

    response.json(state)
  } catch (error) {
    next(error)
  }
}

app.post('/api/costs/:id', upload.single('invoice'), updateCost)

app.patch('/api/costs/:id/toggle', async (request, response, next) => {
  try {
    const state = await readState()
    state.costs = state.costs.map((cost) =>
      cost.id === request.params.id
        ? {
            ...cost,
            status: cost.status === 'paid' ? 'unpaid' : 'paid',
            paidDate: cost.status === 'paid' ? '' : getToday(),
          }
        : cost,
    )
    await writeState(state)
    response.json(state)
  } catch (error) {
    next(error)
  }
})

app.patch('/api/costs/:id', upload.single('invoice'), updateCost)

app.delete('/api/costs/:id', async (request, response, next) => {
  try {
    const state = await readState()
    const cost = state.costs.find((item) => item.id === request.params.id)
    state.costs = state.costs.filter((item) => item.id !== request.params.id)
    await writeState(state)

    if (cost?.attachment?.path) {
      const invoicePath = path.join(rootDir, cost.attachment.path.replace(/^\//, ''))
      await fs.rm(invoicePath, { force: true }).catch(() => undefined)
    }

    response.json(state)
  } catch (error) {
    next(error)
  }
})

app.use(express.static(path.join(rootDir, 'dist')))
app.use((_request, response) => {
  response.sendFile(path.join(rootDir, 'dist', 'index.html'))
})

app.use((error, _request, response, _next) => {
  console.error(error)
  response.status(500).json({ message: 'Wystapil blad serwera.' })
})

await ensureStorage()
app.listen(port, () => {
  console.log(`Budowa API listening on http://localhost:${port}`)
})
