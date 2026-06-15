<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$dataDir = __DIR__ . '/storage';
$uploadsDir = __DIR__ . '/uploads';
$dataFile = $dataDir . '/budowa.json';
$legacyDataFile = __DIR__ . '/server/data/budowa.json';
$exampleDataFile = __DIR__ . '/server/data/budowa.example.json';

$initialState = [
    'tasks' => [
        [
            'id' => uuid(),
            'title' => 'Zamowic kierownika budowy na odbior zbrojenia',
            'area' => 'Stan surowy',
            'priority' => 'Pilne',
            'dueDate' => '2026-06-18',
            'status' => 'todo',
        ],
        [
            'id' => uuid(),
            'title' => 'Sprawdzic wycene bloczkow i transportu',
            'area' => 'Materialy',
            'priority' => 'Normalne',
            'dueDate' => '2026-06-21',
            'status' => 'todo',
        ],
        [
            'id' => uuid(),
            'title' => 'Zapisac pomiar geodety do dokumentow',
            'area' => 'Dokumenty',
            'priority' => 'Normalne',
            'dueDate' => '2026-06-10',
            'status' => 'done',
        ],
    ],
    'costs' => [
        [
            'id' => uuid(),
            'title' => 'Mapa do celow projektowych',
            'area' => 'Dokumenty',
            'category' => 'Dokumenty',
            'amount' => 850,
            'status' => 'paid',
            'paidDate' => '2026-06-05',
        ],
        [
            'id' => uuid(),
            'title' => 'Zaliczka za stal zbrojeniowa',
            'area' => 'Fundamenty',
            'category' => 'Materialy',
            'amount' => 6400,
            'status' => 'unpaid',
            'paidDate' => '',
        ],
    ],
];

function uuid(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function ensureStorage(array $initialState, string $dataDir, string $uploadsDir, string $dataFile, string $legacyDataFile, string $exampleDataFile): void
{
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0775, true);
    }
    if (!is_dir($uploadsDir)) {
        mkdir($uploadsDir, 0775, true);
    }
    if (!is_file($dataFile)) {
        if (is_file($legacyDataFile)) {
            copy($legacyDataFile, $dataFile);
            return;
        }

        if (is_file($exampleDataFile)) {
            copy($exampleDataFile, $dataFile);
            return;
        }

        file_put_contents($dataFile, json_encode($initialState, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
}

function readState(string $dataFile): array
{
    $content = file_get_contents($dataFile);
    $state = json_decode($content ?: '', true);
    return is_array($state) ? $state : ['tasks' => [], 'costs' => []];
}

function writeState(string $dataFile, array $state): void
{
    file_put_contents($dataFile, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function cleanText(mixed $value, string $fallback = ''): string
{
    $text = trim((string)($value ?? $fallback));
    return $text !== '' ? $text : $fallback;
}

function respond(mixed $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

ensureStorage($initialState, $dataDir, $uploadsDir, $dataFile, $legacyDataFile, $exampleDataFile);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$resource = $_GET['resource'] ?? 'state';
$id = $_GET['id'] ?? '';
$action = $_GET['action'] ?? '';
$state = readState($dataFile);

try {
    if ($resource === 'state' && $method === 'GET') {
        respond($state);
    }

    if ($resource === 'tasks' && $method === 'POST') {
        $body = readJsonBody();
        $title = cleanText($body['title'] ?? '');

        if ($title === '') {
            respond(['message' => 'Brakuje nazwy zadania.'], 400);
        }

        $task = [
            'id' => uuid(),
            'title' => $title,
            'area' => cleanText($body['area'] ?? '', 'Inne'),
            'priority' => cleanText($body['priority'] ?? '', 'Normalne'),
            'dueDate' => cleanText($body['dueDate'] ?? ''),
            'status' => 'todo',
        ];

        array_unshift($state['tasks'], $task);
        writeState($dataFile, $state);
        respond($task, 201);
    }

    if ($resource === 'tasks' && $method === 'PATCH' && $action === 'toggle') {
        foreach ($state['tasks'] as &$task) {
            if (($task['id'] ?? '') === $id) {
                $task['status'] = ($task['status'] ?? 'todo') === 'todo' ? 'done' : 'todo';
            }
        }
        unset($task);

        writeState($dataFile, $state);
        respond($state);
    }

    if ($resource === 'tasks' && $method === 'PATCH') {
        $body = readJsonBody();
        $title = cleanText($body['title'] ?? '');

        if ($title === '') {
            respond(['message' => 'Brakuje nazwy zadania.'], 400);
        }

        foreach ($state['tasks'] as &$task) {
            if (($task['id'] ?? '') === $id) {
                $task['title'] = $title;
                $task['area'] = cleanText($body['area'] ?? '', 'Inne');
                $task['priority'] = cleanText($body['priority'] ?? '', 'Normalne');
                $task['dueDate'] = cleanText($body['dueDate'] ?? '');
            }
        }
        unset($task);

        writeState($dataFile, $state);
        respond($state);
    }

    if ($resource === 'tasks' && $method === 'DELETE') {
        $state['tasks'] = array_values(array_filter(
            $state['tasks'],
            static fn(array $task): bool => ($task['id'] ?? '') !== $id
        ));

        writeState($dataFile, $state);
        respond($state);
    }

    if ($resource === 'costs' && $method === 'POST') {
        $amount = (float)($_POST['amount'] ?? 0);
        $title = cleanText($_POST['title'] ?? '');
        $status = ($_POST['status'] ?? '') === 'paid' ? 'paid' : 'unpaid';

        if ($title === '' || $amount <= 0) {
            respond(['message' => 'Podaj opis i prawidlowa kwote kosztu.'], 400);
        }

        $attachment = null;
        if (isset($_FILES['invoice']) && is_uploaded_file($_FILES['invoice']['tmp_name'])) {
            $originalName = basename((string)$_FILES['invoice']['name']);
            $extension = pathinfo($originalName, PATHINFO_EXTENSION);
            $baseName = preg_replace('/[^a-zA-Z0-9-]+/', '-', pathinfo($originalName, PATHINFO_FILENAME)) ?: 'faktura';
            $fileName = time() . '-' . trim(substr($baseName, 0, 60), '-') . ($extension ? '.' . $extension : '');
            $target = $uploadsDir . '/' . $fileName;

            if (!move_uploaded_file($_FILES['invoice']['tmp_name'], $target)) {
                respond(['message' => 'Nie udalo sie zapisac faktury.'], 500);
            }

            $attachment = [
                'name' => $originalName,
                'path' => 'uploads/' . $fileName,
                'mimeType' => (string)($_FILES['invoice']['type'] ?? 'application/octet-stream'),
            ];
        }

        if ($id !== '') {
            $previousAttachment = null;
            foreach ($state['costs'] as &$cost) {
                if (($cost['id'] ?? '') === $id) {
                    $previousAttachment = $cost['attachment'] ?? null;
                    $cost['title'] = $title;
                    $cost['area'] = cleanText($_POST['area'] ?? '', 'Stan surowy');
                    $cost['category'] = cleanText($_POST['category'] ?? '', 'Inne');
                    $cost['amount'] = $amount;
                    $cost['status'] = $status;
                    $cost['paidDate'] = $status === 'paid' ? cleanText($_POST['paidDate'] ?? '', date('Y-m-d')) : '';

                    if ($attachment !== null) {
                        $cost['attachment'] = $attachment;
                    }
                }
            }
            unset($cost);

            if ($attachment !== null && isset($previousAttachment['path'])) {
                $invoicePath = __DIR__ . '/' . ltrim((string)$previousAttachment['path'], '/');
                if (is_file($invoicePath)) {
                    unlink($invoicePath);
                }
            }

            writeState($dataFile, $state);
            respond($state);
        }

        $cost = [
            'id' => uuid(),
            'title' => $title,
            'area' => cleanText($_POST['area'] ?? '', 'Stan surowy'),
            'category' => cleanText($_POST['category'] ?? '', 'Inne'),
            'amount' => $amount,
            'status' => $status,
            'paidDate' => $status === 'paid' ? cleanText($_POST['paidDate'] ?? '', date('Y-m-d')) : '',
        ];

        if ($attachment !== null) {
            $cost['attachment'] = $attachment;
        }

        array_unshift($state['costs'], $cost);
        writeState($dataFile, $state);
        respond($cost, 201);
    }

    if ($resource === 'costs' && $method === 'PATCH' && $action === 'toggle') {
        foreach ($state['costs'] as &$cost) {
            if (($cost['id'] ?? '') === $id) {
                $isPaid = ($cost['status'] ?? 'unpaid') === 'paid';
                $cost['status'] = $isPaid ? 'unpaid' : 'paid';
                $cost['paidDate'] = $isPaid ? '' : date('Y-m-d');
            }
        }
        unset($cost);

        writeState($dataFile, $state);
        respond($state);
    }

    if ($resource === 'costs' && $method === 'DELETE') {
        $deleted = null;
        $state['costs'] = array_values(array_filter(
            $state['costs'],
            static function (array $cost) use ($id, &$deleted): bool {
                if (($cost['id'] ?? '') === $id) {
                    $deleted = $cost;
                    return false;
                }
                return true;
            }
        ));

        if (isset($deleted['attachment']['path'])) {
            $invoicePath = __DIR__ . '/' . ltrim((string)$deleted['attachment']['path'], '/');
            if (is_file($invoicePath)) {
                unlink($invoicePath);
            }
        }

        writeState($dataFile, $state);
        respond($state);
    }

    respond(['message' => 'Nieznana akcja API.'], 404);
} catch (Throwable $error) {
    respond(['message' => 'Wystapil blad serwera.'], 500);
}
