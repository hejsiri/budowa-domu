import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import multer from 'multer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const storageDir = path.join(rootDir, 'storage')
const uploadsDir = path.join(rootDir, 'uploads')
const dataFile = path.join(storageDir, 'budowa.json')
const legacyDataFile = path.join(__dirname, 'data', 'budowa.json')
const exampleDataFile = path.join(__dirname, 'data', 'budowa.example.json')
const port = Number(process.env.PORT || 4174)

const initialState = {
  tasks: [
    {
      id: randomUUID(),
      title: 'Zamowic kierownika budowy na odbior zbrojenia',
      area: 'Stan surowy',
      priority: 'Pilne',
      dueDate: '2026-06-18',
      status: 'todo',
    },
    {
      id: randomUUID(),
      title: 'Sprawdzic wycene bloczkow i transportu',
      area: 'Materialy',
      priority: 'Normalne',
      dueDate: '2026-06-21',
      status: 'todo',
    },
    {
      id: randomUUID(),
      title: 'Zapisac pomiar geodety do dokumentow',
      area: 'Dokumenty',
      priority: 'Normalne',
      dueDate: '2026-06-10',
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

const app = express()
app.use(express.json())
app.use('/uploads', express.static(uploadsDir))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/state', async (_request, response, next) => {
  try {
    response.json(await readState())
  } catch (error) {
    next(error)
  }
})

app.post('/api/tasks', async (request, response, next) => {
  try {
    const state = await readState()
    const task = {
      id: randomUUID(),
      title: cleanText(request.body.title),
      area: cleanText(request.body.area, 'Stan surowy'),
      priority: cleanText(request.body.priority, 'Normalne'),
      dueDate: cleanText(request.body.dueDate),
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
    state.tasks = state.tasks.filter((task) => task.id !== request.params.id)
    await writeState(state)
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
