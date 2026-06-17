<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$requiredPhpVersion = '7.4.0';
if (version_compare(PHP_VERSION, $requiredPhpVersion, '<')) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Hosting ma za stara wersje PHP. Wymagane PHP ' . $requiredPhpVersion . ' lub nowsze, aktualnie: ' . PHP_VERSION . '.',
        'requiredPhpVersion' => $requiredPhpVersion,
        'currentPhpVersion' => PHP_VERSION,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$dataDir = __DIR__ . '/storage';
$uploadsDir = __DIR__ . '/uploads';
$dataFile = $dataDir . '/budowa.json';
$usersFile = $dataDir . '/users.json';
$sessionsFile = $dataDir . '/sessions.json';
$legacyDataFile = __DIR__ . '/server/data/budowa.json';
$exampleDataFile = __DIR__ . '/server/data/budowa.example.json';
$sessionCookieName = 'budowa_session';
$richTextLimit = 50000;
$privateDirectoryMode = 0750;
$privateFileMode = 0640;
$allowedUploadExtensions = ['avif', 'csv', 'doc', 'docx', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'pdf', 'png', 'txt', 'webp', 'xls', 'xlsx'];
$allowedUploadMimeTypes = [
    'application/msword',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'text/plain',
];

$initialState = [
    'tasks' => [
        [
            'id' => uuid(),
            'title' => 'Zamowic kierownika budowy na odbior zbrojenia',
            'area' => 'Stan surowy',
            'priority' => 'Pilne',
            'dueDate' => '2026-06-18',
            'startTime' => '09:00',
            'endTime' => '10:00',
            'comment' => '',
            'attachments' => [],
            'status' => 'todo',
        ],
        [
            'id' => uuid(),
            'title' => 'Sprawdzic wycene bloczkow i transportu',
            'area' => 'Materialy',
            'priority' => 'Normalne',
            'dueDate' => '2026-06-21',
            'startTime' => '09:00',
            'endTime' => '10:00',
            'comment' => '',
            'attachments' => [],
            'status' => 'todo',
        ],
        [
            'id' => uuid(),
            'title' => 'Zapisac pomiar geodety do dokumentow',
            'area' => 'Dokumenty',
            'priority' => 'Normalne',
            'dueDate' => '2026-06-10',
            'startTime' => '09:00',
            'endTime' => '10:00',
            'comment' => '',
            'attachments' => [],
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
            'payer' => 'me',
            'investorShare' => 100,
            'partnerShare' => 0,
            'status' => 'paid',
            'paidDate' => '2026-06-05',
        ],
        [
            'id' => uuid(),
            'title' => 'Zaliczka za stal zbrojeniowa',
            'area' => 'Fundamenty',
            'category' => 'Materialy',
            'amount' => 6400,
            'payer' => 'half',
            'investorShare' => 50,
            'partnerShare' => 50,
            'status' => 'planned',
            'paidDate' => '',
        ],
    ],
    'wallet' => [
        'transactions' => [],
    ],
    'settings' => [
        'investors' => [
            'primary' => 'Ja',
            'partner' => 'Drugi inwestor',
            'primaryEmail' => '',
            'partnerEmail' => '',
        ],
        'calendarToken' => uuid(),
    ],
];

function uuid(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function readStorageFile(string $file, array $fallback): array
{
    if (!is_file($file)) {
        return $fallback;
    }

    $decoded = json_decode(file_get_contents($file) ?: '', true);
    return is_array($decoded) ? $decoded : $fallback;
}

function writeStorageFile(string $file, array $payload)
{
    global $privateDirectoryMode, $privateFileMode;
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, $privateDirectoryMode, true);
    }

    file_put_contents($file, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    @chmod($dir, $privateDirectoryMode);
    @chmod($file, $privateFileMode);
}

function getUsers(string $usersFile): array
{
    $store = readStorageFile($usersFile, ['users' => [], 'pendingRegistration' => null]);
    $store['users'] = is_array($store['users'] ?? null) ? $store['users'] : [];
    return $store;
}

function userCount(string $usersFile): int
{
    return count(getUsers($usersFile)['users']);
}

function cleanEmail($value): string
{
    return strtolower(trim((string)($value ?? '')));
}

function generateCode(): string
{
    return (string)random_int(100000, 999999);
}

function sendVerificationEmail(string $email, string $code): bool
{
    $subject = 'Kod weryfikacyjny Budowa domu';
    $message = "Twoj kod weryfikacyjny to: {$code}\n\nKod jest wazny 5 minut.";
    $headers = [
        'Content-Type: text/plain; charset=UTF-8',
        'From: Budowa domu <no-reply@macbook.host>',
    ];

    return mail($email, $subject, $message, implode("\r\n", $headers));
}

function cookieOptions(int $expires): array
{
    return [
        'expires' => $expires,
        'path' => '/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https',
        'httponly' => true,
        'samesite' => 'Lax',
    ];
}

function createSession(string $sessionsFile, string $email)
{
    $token = bin2hex(random_bytes(32));
    $sessions = readStorageFile($sessionsFile, ['sessions' => []]);
    $sessions['sessions'] = array_values(array_filter(
        $sessions['sessions'] ?? [],
        static function (array $session): bool {
            return (int)($session['expiresAt'] ?? 0) > time();
        }
    ));
    $sessions['sessions'][] = [
        'tokenHash' => hash('sha256', $token),
        'email' => $email,
        'expiresAt' => time() + 60 * 60 * 24 * 14,
    ];

    writeStorageFile($sessionsFile, $sessions);
    setcookie('budowa_session', $token, cookieOptions(time() + 60 * 60 * 24 * 14));
}

function currentUser(string $sessionsFile)
{
    $token = (string)($_COOKIE['budowa_session'] ?? '');
    if ($token === '') {
        return null;
    }

    $sessions = readStorageFile($sessionsFile, ['sessions' => []]);
    $tokenHash = hash('sha256', $token);

    foreach ($sessions['sessions'] ?? [] as $session) {
        if ((int)($session['expiresAt'] ?? 0) > time() && hash_equals((string)($session['tokenHash'] ?? ''), $tokenHash)) {
            return ['email' => (string)($session['email'] ?? '')];
        }
    }

    return null;
}

function clearSession(string $sessionsFile)
{
    $token = (string)($_COOKIE['budowa_session'] ?? '');
    if ($token !== '') {
        $tokenHash = hash('sha256', $token);
        $sessions = readStorageFile($sessionsFile, ['sessions' => []]);
        $sessions['sessions'] = array_values(array_filter(
            $sessions['sessions'] ?? [],
            static function (array $session) use ($tokenHash): bool {
                return !hash_equals((string)($session['tokenHash'] ?? ''), $tokenHash);
            }
        ));
        writeStorageFile($sessionsFile, $sessions);
    }

    setcookie('budowa_session', '', cookieOptions(time() - 3600));
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function ensureStorage(array $initialState, string $dataDir, string $uploadsDir, string $dataFile, string $legacyDataFile, string $exampleDataFile)
{
    global $privateDirectoryMode, $privateFileMode;
    if (!is_dir($dataDir)) {
        mkdir($dataDir, $privateDirectoryMode, true);
    }
    if (!is_dir($uploadsDir)) {
        mkdir($uploadsDir, $privateDirectoryMode, true);
    }
    @chmod($dataDir, $privateDirectoryMode);
    @chmod($uploadsDir, $privateDirectoryMode);
    if (!is_file($dataFile)) {
        if (is_file($legacyDataFile)) {
            copy($legacyDataFile, $dataFile);
            @chmod($dataFile, $privateFileMode);
            return;
        }

        if (is_file($exampleDataFile)) {
            copy($exampleDataFile, $dataFile);
            @chmod($dataFile, $privateFileMode);
            return;
        }

        file_put_contents($dataFile, json_encode($initialState, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        @chmod($dataFile, $privateFileMode);
    }
}

function readState(string $dataFile): array
{
    $content = file_get_contents($dataFile);
    $state = json_decode($content ?: '', true);
    if (!is_array($state)) {
        $state = ['tasks' => [], 'costs' => []];
    }

    $hadCalendarToken = cleanText($state['settings']['calendarToken'] ?? '') !== '';
    $hadWallet = isset($state['wallet']) && is_array($state['wallet']);
    $state['settings'] = normalizeSettings($state['settings'] ?? []);
    $state['tasks'] = array_map('normalizeTask', is_array($state['tasks'] ?? null) ? $state['tasks'] : []);
    $state['wallet'] = normalizeWallet($state['wallet'] ?? []);
    if (!$hadCalendarToken || !$hadWallet) {
        writeState($dataFile, $state);
    }
    return $state;
}

function writeState(string $dataFile, array $state)
{
    global $privateFileMode;
    file_put_contents($dataFile, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    @chmod($dataFile, $privateFileMode);
}

function cleanText($value, string $fallback = ''): string
{
    $text = trim((string)($value ?? $fallback));
    return $text !== '' ? $text : $fallback;
}

function cleanRichText($value): string
{
    global $richTextLimit;
    $html = substr((string)($value ?? ''), 0, $richTextLimit);
    $html = preg_replace('/<\s*(script|style)[^>]*>.*?<\s*\/\s*\1\s*>/is', '', $html) ?? '';
    $html = strip_tags($html, '<b><strong><i><em><u><br><p><ul><ol><li>');
    $html = preg_replace('/<([a-z][a-z0-9]*)\b[^>]*>/i', '<$1>', $html) ?? '';
    return trim($html);
}

function normalizeSettings($settings): array
{
    $investors = is_array($settings['investors'] ?? null) ? $settings['investors'] : [];
    $calendarToken = cleanText($settings['calendarToken'] ?? '');

    return [
        'investors' => [
            'primary' => cleanText($investors['primary'] ?? '', 'Ja'),
            'partner' => cleanText($investors['partner'] ?? '', 'Drugi inwestor'),
            'primaryEmail' => cleanEmail($investors['primaryEmail'] ?? ''),
            'partnerEmail' => cleanEmail($investors['partnerEmail'] ?? ''),
        ],
        'calendarToken' => $calendarToken !== '' ? $calendarToken : uuid(),
    ];
}

function cleanTime($value, string $fallback = ''): string
{
    $time = trim((string)($value ?? ''));
    return preg_match('/^\d{2}:\d{2}$/', $time) === 1 ? $time : $fallback;
}

function cleanPriority($value): string
{
    return cleanText($value ?? '', 'Normalne') === 'Pilne' ? 'Pilne' : 'Normalne';
}

function cleanCostStatus($value): string
{
    $status = cleanText($value ?? '', 'planned');
    return in_array($status, ['planned', 'unpaid', 'paid'], true) ? $status : 'planned';
}

function cleanAmount($value, float $fallback = 0): float
{
    $amount = (float)($value ?? $fallback);
    return is_finite($amount) ? $amount : $fallback;
}

function isChecked($value): bool
{
    return in_array(strtolower((string)($value ?? '')), ['1', 'true', 'on', 'yes'], true);
}

function normalizeWalletTransaction($transaction): array
{
    $transaction = is_array($transaction) ? $transaction : [];
    $transaction['id'] = cleanText($transaction['id'] ?? '', uuid());
    $transaction['date'] = cleanText($transaction['date'] ?? '', date('Y-m-d'));
    $transaction['description'] = cleanText($transaction['description'] ?? '', 'Transakcja Portfela');
    $transaction['amount'] = cleanAmount($transaction['amount'] ?? 0);
    $transaction['costId'] = cleanText($transaction['costId'] ?? '');
    return $transaction;
}

function normalizeWallet($wallet): array
{
    $transactions = is_array($wallet['transactions'] ?? null) ? $wallet['transactions'] : [];
    return [
        'transactions' => array_map('normalizeWalletTransaction', $transactions),
    ];
}

function walletTransactionForCost(array $cost, string $transactionId = ''): array
{
    return [
        'id' => $transactionId !== '' ? $transactionId : uuid(),
        'date' => cleanText($cost['paidDate'] ?? '', date('Y-m-d')),
        'description' => 'Płatność: ' . cleanText($cost['title'] ?? '', 'Wydatek'),
        'amount' => -abs(cleanAmount($cost['amount'] ?? 0)),
        'costId' => cleanText($cost['id'] ?? ''),
    ];
}

function syncCostWalletTransaction(array &$state, array &$cost, bool $shouldUseWallet)
{
    $state['wallet'] = normalizeWallet($state['wallet'] ?? []);
    $currentTransactionId = cleanText($cost['walletTransactionId'] ?? '');

    if (cleanCostStatus($cost['status'] ?? '') !== 'paid' || !$shouldUseWallet) {
        if ($currentTransactionId !== '') {
            $state['wallet']['transactions'] = array_values(array_filter(
                $state['wallet']['transactions'],
                static function (array $transaction) use ($currentTransactionId): bool {
                    return (string)($transaction['id'] ?? '') !== $currentTransactionId;
                }
            ));
            unset($cost['walletTransactionId']);
        }
        return;
    }

    if ($currentTransactionId !== '') {
        $updatedExistingTransaction = false;
        foreach ($state['wallet']['transactions'] as &$transaction) {
            if ((string)($transaction['id'] ?? '') === $currentTransactionId) {
                $transaction = walletTransactionForCost($cost, $currentTransactionId);
                $updatedExistingTransaction = true;
            }
        }
        unset($transaction);
        if (!$updatedExistingTransaction) {
            array_unshift($state['wallet']['transactions'], walletTransactionForCost($cost, $currentTransactionId));
        }
        return;
    }

    $transaction = walletTransactionForCost($cost);
    $cost['walletTransactionId'] = $transaction['id'];
    array_unshift($state['wallet']['transactions'], $transaction);
}

function normalizeTask($task): array
{
    $task = is_array($task) ? $task : [];
    $task['id'] = cleanText($task['id'] ?? '', uuid());
    $task['title'] = cleanText($task['title'] ?? '');
    $task['area'] = cleanText($task['area'] ?? '', 'Inne');
    $task['priority'] = cleanPriority($task['priority'] ?? '');
    $task['dueDate'] = cleanText($task['dueDate'] ?? '');
    $task['startTime'] = cleanTime($task['startTime'] ?? '', '09:00');
    $task['endTime'] = cleanTime($task['endTime'] ?? '', '10:00');
    $task['comment'] = cleanText($task['comment'] ?? '');
    $task['attachments'] = is_array($task['attachments'] ?? null) ? $task['attachments'] : [];
    $task['status'] = ($task['status'] ?? 'todo') === 'done' ? 'done' : 'todo';
    return $task;
}

function calendarDate(string $date, string $time): string
{
    return str_replace(['-', ':'], '', $date . 'T' . $time . '00');
}

function calendarEndDate(string $date, string $start, string $end): string
{
    if ($end > $start) {
        return calendarDate($date, $end);
    }

    $dateTime = DateTimeImmutable::createFromFormat('Y-m-d H:i', $date . ' ' . $start, new DateTimeZone('Europe/Warsaw'));
    if (!$dateTime) {
        return calendarDate($date, $start);
    }

    return $dateTime->modify('+1 hour')->format('Ymd\THis');
}

function escapeCalendarText(string $text): string
{
    return str_replace(
        ["\\", "\r\n", "\n", "\r", ';', ','],
        ["\\\\", "\\n", "\\n", "\\n", "\\;", "\\,"],
        $text
    );
}

function renderCalendar(array $state)
{
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: inline; filename="budowa-domu.ics"');

    $lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Budowa domu//Zadania//PL',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Budowa domu',
        'X-WR-TIMEZONE:Europe/Warsaw',
    ];

    foreach ($state['tasks'] as $task) {
        if (($task['dueDate'] ?? '') === '') {
            continue;
        }

        $start = cleanTime($task['startTime'] ?? '', '09:00');
        $end = cleanTime($task['endTime'] ?? '', '10:00');

        $description = trim(($task['area'] ?? '') . "\n" . ($task['comment'] ?? ''));
        $lines[] = 'BEGIN:VEVENT';
        $lines[] = 'UID:' . escapeCalendarText((string)$task['id']) . '@budowa-domu';
        $lines[] = 'DTSTAMP:' . gmdate('Ymd\THis\Z');
        $lines[] = 'DTSTART;TZID=Europe/Warsaw:' . calendarDate((string)$task['dueDate'], $start);
        $lines[] = 'DTEND;TZID=Europe/Warsaw:' . calendarEndDate((string)$task['dueDate'], $start, $end);
        $lines[] = 'SUMMARY:' . escapeCalendarText((string)$task['title']);
        if ($description !== '') {
            $lines[] = 'DESCRIPTION:' . escapeCalendarText($description);
        }
        $lines[] = 'STATUS:CONFIRMED';
        $lines[] = 'END:VEVENT';
    }

    $lines[] = 'END:VCALENDAR';
    echo implode("\r\n", $lines) . "\r\n";
    exit;
}

function cleanPayer($value): string
{
    $payer = (string)($value ?? 'me');
    return in_array($payer, ['me', 'partner', 'half', 'custom'], true) ? $payer : 'me';
}

function cleanShare($value, float $fallback): float
{
    $share = is_numeric($value) ? (float)$value : $fallback;
    return min(100, max(0, $share));
}

function paymentSplitFromPost(): array
{
    $payer = cleanPayer($_POST['payer'] ?? 'me');
    $investorShare = cleanShare($_POST['investorShare'] ?? 100, 100);

    if ($payer === 'partner') {
        $investorShare = 0;
    } elseif ($payer === 'half') {
        $investorShare = 50;
    } elseif ($payer === 'me') {
        $investorShare = 100;
    }

    return [
        'payer' => $payer,
        'investorShare' => $investorShare,
        'partnerShare' => cleanShare($_POST['partnerShare'] ?? (100 - $investorShare), 100 - $investorShare),
    ];
}

function uploadedFiles(string $field): array
{
    if (!isset($_FILES[$field])) {
        return [];
    }

    $fileSet = $_FILES[$field];
    if (!is_array($fileSet['name'])) {
        return [$fileSet];
    }

    $files = [];
    foreach ($fileSet['name'] as $index => $name) {
        $files[] = [
            'name' => $name,
            'type' => $fileSet['type'][$index] ?? 'application/octet-stream',
            'tmp_name' => $fileSet['tmp_name'][$index] ?? '',
            'error' => $fileSet['error'][$index] ?? UPLOAD_ERR_NO_FILE,
            'size' => $fileSet['size'][$index] ?? 0,
        ];
    }

    return $files;
}

function isAllowedUploadedFile(array $file): bool
{
    global $allowedUploadExtensions, $allowedUploadMimeTypes;

    $originalName = basename((string)($file['name'] ?? ''));
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $reportedMimeType = strtolower((string)($file['type'] ?? ''));
    $detectedMimeType = '';

    if (is_file((string)($file['tmp_name'] ?? ''))) {
        $detectedMimeType = strtolower(mime_content_type((string)$file['tmp_name']) ?: '');
    }

    if (!in_array($extension, $allowedUploadExtensions, true)) {
        return false;
    }

    if (strpos($reportedMimeType, 'image/') === 0 || strpos($detectedMimeType, 'image/') === 0) {
        return true;
    }

    return in_array($reportedMimeType, $allowedUploadMimeTypes, true)
        || in_array($detectedMimeType, $allowedUploadMimeTypes, true);
}

function saveUploadedFiles(string $field, string $uploadsDir, string $fallbackBaseName): array
{
    global $privateFileMode;
    $attachments = [];

    foreach (uploadedFiles($field) as $file) {
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file((string)$file['tmp_name'])) {
            continue;
        }

        if (!isAllowedUploadedFile($file)) {
            respond(['message' => 'Ten typ pliku nie jest dozwolony.'], 400);
        }

        $originalName = basename((string)$file['name']);
        $extension = pathinfo($originalName, PATHINFO_EXTENSION);
        $baseName = preg_replace('/[^a-zA-Z0-9-]+/', '-', pathinfo($originalName, PATHINFO_FILENAME)) ?: $fallbackBaseName;
        $fileName = time() . '-' . bin2hex(random_bytes(4)) . '-' . trim(substr($baseName, 0, 50), '-') . ($extension ? '.' . $extension : '');
        $target = $uploadsDir . '/' . $fileName;

        if (!move_uploaded_file((string)$file['tmp_name'], $target)) {
            respond(['message' => 'Nie udalo sie zapisac zalacznika.'], 500);
        }
        @chmod($target, $privateFileMode);

        $attachments[] = [
            'name' => $originalName,
            'path' => 'uploads/' . $fileName,
            'mimeType' => (string)($file['type'] ?? 'application/octet-stream'),
        ];
    }

    return $attachments;
}

function deleteAttachmentFiles(array $attachments)
{
    foreach ($attachments as $attachment) {
        if (!isset($attachment['path'])) {
            continue;
        }

        $filePath = __DIR__ . '/' . ltrim((string)$attachment['path'], '/');
        if (is_file($filePath)) {
            unlink($filePath);
        }
    }
}

function removalPaths($value): array
{
    $decoded = json_decode((string)($value ?? '[]'), true);
    if (!is_array($decoded)) {
        return [];
    }

    return array_values(array_filter(array_map('strval', $decoded)));
}

function filterRemovedAttachments(array $attachments, array $removePaths): array
{
    return array_values(array_filter(
        $attachments,
        static function (array $attachment) use ($removePaths): bool {
            return !in_array((string)($attachment['path'] ?? ''), $removePaths, true);
        }
    ));
}

function costAttachments(array $cost): array
{
    $attachments = is_array($cost['attachments'] ?? null) ? $cost['attachments'] : [];
    if (isset($cost['attachment']) && is_array($cost['attachment'])) {
        $legacyPath = (string)($cost['attachment']['path'] ?? '');
        $exists = false;
        foreach ($attachments as $attachment) {
            if ((string)($attachment['path'] ?? '') === $legacyPath) {
                $exists = true;
                break;
            }
        }
        if (!$exists) {
            $attachments[] = $cost['attachment'];
        }
    }

    return $attachments;
}

function respond($payload, int $status = 200)
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
        if (!currentUser($sessionsFile)) {
            respond(['message' => 'Zaloguj sie, aby zobaczyc panel.'], 401);
        }
        respond($state);
    }

    if ($resource === 'auth' && $method === 'GET') {
        $user = currentUser($sessionsFile);
        respond([
            'authenticated' => $user !== null,
            'setupRequired' => userCount($usersFile) === 0,
            'email' => $user['email'] ?? '',
        ]);
    }

    if ($resource === 'auth' && $method === 'POST' && $action === 'register-start') {
        if (userCount($usersFile) > 0) {
            respond(['message' => 'Rejestracja jest juz zablokowana.'], 403);
        }

        $body = readJsonBody();
        $email = cleanEmail($body['email'] ?? '');
        $password = (string)($body['password'] ?? '');
        $passwordConfirm = (string)($body['passwordConfirm'] ?? '');

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            respond(['message' => 'Podaj poprawny adres email.'], 400);
        }

        if (strlen($password) < 8 || $password !== $passwordConfirm) {
            respond(['message' => 'Hasla musza byc takie same i miec minimum 8 znakow.'], 400);
        }

        $code = generateCode();
        $store = getUsers($usersFile);
        $store['pendingRegistration'] = [
            'email' => $email,
            'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
            'codeHash' => password_hash($code, PASSWORD_DEFAULT),
            'expiresAt' => time() + 60 * 5,
        ];
        writeStorageFile($usersFile, $store);

        if (!sendVerificationEmail($email, $code)) {
            respond(['message' => 'Nie udalo sie wyslac kodu email. Sprawdz konfiguracje poczty na hostingu.'], 500);
        }

        respond(['message' => 'Wyslano kod weryfikacyjny.']);
    }

    if ($resource === 'auth' && $method === 'POST' && $action === 'register-verify') {
        if (userCount($usersFile) > 0) {
            respond(['message' => 'Rejestracja jest juz zablokowana.'], 403);
        }

        $body = readJsonBody();
        $code = trim((string)($body['code'] ?? ''));
        $store = getUsers($usersFile);
        $pending = $store['pendingRegistration'] ?? null;

        if (!is_array($pending) || (int)($pending['expiresAt'] ?? 0) < time()) {
            respond(['message' => 'Kod wygasl. Wyslij formularz rejestracji ponownie.'], 400);
        }

        if (!password_verify($code, (string)($pending['codeHash'] ?? ''))) {
            respond(['message' => 'Niepoprawny kod weryfikacyjny.'], 400);
        }

        $store['users'] = [[
            'id' => uuid(),
            'email' => (string)$pending['email'],
            'passwordHash' => (string)$pending['passwordHash'],
            'createdAt' => date(DATE_ATOM),
        ]];
        $store['pendingRegistration'] = null;
        writeStorageFile($usersFile, $store);
        respond(['message' => 'Konto zostalo utworzone. Mozesz sie zalogowac.']);
    }

    if ($resource === 'auth' && $method === 'POST' && $action === 'login') {
        $body = readJsonBody();
        $email = cleanEmail($body['email'] ?? '');
        $password = (string)($body['password'] ?? '');
        $store = getUsers($usersFile);

        foreach ($store['users'] as $user) {
            if (($user['email'] ?? '') === $email && password_verify($password, (string)($user['passwordHash'] ?? ''))) {
                createSession($sessionsFile, $email);
                respond(['authenticated' => true, 'email' => $email]);
            }
        }

        respond(['message' => 'Niepoprawny email lub haslo.'], 401);
    }

    if ($resource === 'auth' && $method === 'POST' && $action === 'logout') {
        clearSession($sessionsFile);
        respond(['authenticated' => false]);
    }

    if ($resource === 'calendar' && $method === 'GET') {
        $token = cleanText($_GET['token'] ?? '');
        $calendarToken = cleanText($state['settings']['calendarToken'] ?? '');
        if ($token === '' || $calendarToken === '' || !hash_equals($calendarToken, $token)) {
            respond(['message' => 'Niepoprawny link kalendarza.'], 403);
        }

        renderCalendar($state);
    }

    if (!currentUser($sessionsFile)) {
        respond(['message' => 'Sesja wygasla. Zaloguj sie ponownie.'], 401);
    }

    if ($resource === 'auth' && $method === 'POST' && $action === 'change-password') {
        $current = currentUser($sessionsFile);
        $body = readJsonBody();
        $currentPassword = (string)($body['currentPassword'] ?? '');
        $newPassword = (string)($body['newPassword'] ?? '');
        $newPasswordConfirm = (string)($body['newPasswordConfirm'] ?? '');

        if (strlen($newPassword) < 8 || $newPassword !== $newPasswordConfirm) {
            respond(['message' => 'Nowe hasla musza byc takie same i miec minimum 8 znakow.'], 400);
        }

        $store = getUsers($usersFile);
        $updated = false;

        foreach ($store['users'] as &$user) {
            if (($user['email'] ?? '') === ($current['email'] ?? '')) {
                if (!password_verify($currentPassword, (string)($user['passwordHash'] ?? ''))) {
                    respond(['message' => 'Aktualne haslo jest niepoprawne.'], 401);
                }

                $user['passwordHash'] = password_hash($newPassword, PASSWORD_DEFAULT);
                $user['updatedAt'] = date(DATE_ATOM);
                $updated = true;
                break;
            }
        }
        unset($user);

        if (!$updated) {
            respond(['message' => 'Nie znaleziono konta uzytkownika.'], 404);
        }

        writeStorageFile($usersFile, $store);
        respond(['message' => 'Haslo zostalo zmienione.']);
    }

    if ($resource === 'settings' && $method === 'POST') {
        $body = readJsonBody();
        $state['settings'] = normalizeSettings(array_merge($state['settings'] ?? [], $body));
        writeState($dataFile, $state);
        respond($state);
    }

    if ($resource === 'wallet' && $method === 'POST' && $action === 'transactions') {
        $amount = cleanAmount($_POST['amount'] ?? 0);
        $description = cleanText($_POST['description'] ?? '');

        if ($description === '' || $amount <= 0) {
            respond(['message' => 'Podaj opis i prawidlowa kwote transakcji.'], 400);
        }

        if ($id !== '') {
            $state['wallet'] = normalizeWallet($state['wallet'] ?? []);
            $updatedTransaction = null;
            foreach ($state['wallet']['transactions'] as &$transaction) {
                if ((string)($transaction['id'] ?? '') === $id) {
                    $transaction['date'] = cleanText($_POST['date'] ?? '', date('Y-m-d'));
                    $transaction['description'] = $description;
                    $transaction['amount'] = cleanAmount($transaction['amount'] ?? 0) < 0 ? -abs($amount) : abs($amount);
                    $updatedTransaction = $transaction;
                }
            }
            unset($transaction);

            if (!is_array($updatedTransaction)) {
                respond(['message' => 'Nie znaleziono transakcji Portfela.'], 404);
            }

            writeState($dataFile, $state);
            respond($state);
        }

        $transaction = [
            'id' => uuid(),
            'date' => cleanText($_POST['date'] ?? '', date('Y-m-d')),
            'description' => $description,
            'amount' => abs($amount),
        ];

        $state['wallet'] = normalizeWallet($state['wallet'] ?? []);
        array_unshift($state['wallet']['transactions'], $transaction);
        writeState($dataFile, $state);
        respond($transaction, 201);
    }

    if ($resource === 'file' && $method === 'GET') {
        $relativePath = ltrim((string)($_GET['path'] ?? ''), '/');
        $fileName = basename($relativePath);
        $filePath = $uploadsDir . '/' . $fileName;

        if ($relativePath === '' || $relativePath !== 'uploads/' . $fileName || !is_file($filePath)) {
            respond(['message' => 'Nie znaleziono pliku.'], 404);
        }

        $mimeType = mime_content_type($filePath) ?: 'application/octet-stream';
        header('Content-Type: ' . $mimeType);
        header('Content-Disposition: inline; filename="' . addslashes($fileName) . '"');
        header('Content-Length: ' . (string)filesize($filePath));
        readfile($filePath);
        exit;
    }

    if ($resource === 'tasks' && $method === 'POST') {
        $title = cleanText($_POST['title'] ?? '');

        if ($title === '') {
            respond(['message' => 'Brakuje nazwy zadania.'], 400);
        }

        $attachments = array_merge(
            saveUploadedFiles('attachments', $uploadsDir, 'zadanie'),
            saveUploadedFiles('documents', $uploadsDir, 'dokument'),
            saveUploadedFiles('images', $uploadsDir, 'zdjecie')
        );
        $removePaths = removalPaths($_POST['removeAttachments'] ?? '[]');

        if ($id !== '') {
            foreach ($state['tasks'] as &$task) {
                if (($task['id'] ?? '') === $id) {
                    $removedAttachments = array_values(array_filter(
                        $task['attachments'] ?? [],
                        static function (array $attachment) use ($removePaths): bool {
                            return in_array((string)($attachment['path'] ?? ''), $removePaths, true);
                        }
                    ));
                    $existingAttachments = filterRemovedAttachments($task['attachments'] ?? [], $removePaths);
                    deleteAttachmentFiles($removedAttachments);
                    $task['title'] = $title;
                    $task['area'] = cleanText($_POST['area'] ?? '', 'Inne');
                    $task['priority'] = cleanPriority($_POST['priority'] ?? '');
                    $task['dueDate'] = cleanText($_POST['dueDate'] ?? '');
                    $task['startTime'] = cleanTime($_POST['startTime'] ?? '', '09:00');
                    $task['endTime'] = cleanTime($_POST['endTime'] ?? '', '10:00');
                    $task['comment'] = cleanText($_POST['comment'] ?? '');
                    $task['attachments'] = array_values(array_merge($existingAttachments, $attachments));
                }
            }
            unset($task);

            writeState($dataFile, $state);
            respond($state);
        }

        $task = [
            'id' => uuid(),
            'title' => $title,
            'area' => cleanText($_POST['area'] ?? '', 'Inne'),
            'priority' => cleanPriority($_POST['priority'] ?? ''),
            'dueDate' => cleanText($_POST['dueDate'] ?? ''),
            'startTime' => cleanTime($_POST['startTime'] ?? '', '09:00'),
            'endTime' => cleanTime($_POST['endTime'] ?? '', '10:00'),
            'comment' => cleanText($_POST['comment'] ?? ''),
            'attachments' => $attachments,
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
                $task['priority'] = cleanPriority($body['priority'] ?? '');
                $task['dueDate'] = cleanText($body['dueDate'] ?? '');
                $task['startTime'] = cleanTime($body['startTime'] ?? '', '09:00');
                $task['endTime'] = cleanTime($body['endTime'] ?? '', '10:00');
            }
        }
        unset($task);

        writeState($dataFile, $state);
        respond($state);
    }

    if ($resource === 'tasks' && $method === 'DELETE') {
        $deleted = null;
        $state['tasks'] = array_values(array_filter(
            $state['tasks'],
            static function (array $task) use ($id, &$deleted): bool {
                if (($task['id'] ?? '') === $id) {
                    $deleted = $task;
                    return false;
                }
                return true;
            }
        ));

        if (isset($deleted['attachments']) && is_array($deleted['attachments'])) {
            deleteAttachmentFiles($deleted['attachments']);
        }

        writeState($dataFile, $state);
        respond($state);
    }

    if ($resource === 'costs' && $method === 'POST') {
        $amount = (float)($_POST['amount'] ?? 0);
        $title = cleanText($_POST['title'] ?? '');
        $status = cleanCostStatus($_POST['status'] ?? '');

        if ($title === '' || $amount < 0) {
            respond(['message' => 'Podaj opis i prawidlowa kwote kosztu.'], 400);
        }

        $attachments = array_merge(
            saveUploadedFiles('invoice', $uploadsDir, 'faktura'),
            saveUploadedFiles('documents', $uploadsDir, 'dokument'),
            saveUploadedFiles('images', $uploadsDir, 'zdjecie')
        );
        $removePaths = removalPaths($_POST['removeAttachments'] ?? '[]');

        if ($id !== '') {
            $paymentSplit = paymentSplitFromPost();
            foreach ($state['costs'] as &$cost) {
                if (($cost['id'] ?? '') === $id) {
                    $currentAttachments = costAttachments($cost);
                    $removedAttachments = array_values(array_filter(
                        $currentAttachments,
                        static function (array $attachment) use ($removePaths): bool {
                            return in_array((string)($attachment['path'] ?? ''), $removePaths, true);
                        }
                    ));
                    $existingAttachments = filterRemovedAttachments($currentAttachments, $removePaths);
                    deleteAttachmentFiles($removedAttachments);
                    $cost['title'] = $title;
                    $cost['area'] = cleanText($_POST['area'] ?? '', 'Stan surowy');
                    $cost['category'] = cleanText($_POST['category'] ?? '', 'Inne');
                    $cost['amount'] = $amount;
                    $cost['payer'] = $paymentSplit['payer'];
                    $cost['investorShare'] = $paymentSplit['investorShare'];
                    $cost['partnerShare'] = $paymentSplit['partnerShare'];
                    $cost['commentHtml'] = cleanRichText($_POST['commentHtml'] ?? '');
                    $cost['status'] = $status;
                    $cost['paidDate'] = $status === 'paid' ? cleanText($_POST['paidDate'] ?? '', date('Y-m-d')) : '';
                    $cost['attachments'] = array_values(array_merge($existingAttachments, $attachments));
                    unset($cost['attachment']);
                    syncCostWalletTransaction($state, $cost, isChecked($_POST['useWallet'] ?? ''));
                }
            }
            unset($cost);

            writeState($dataFile, $state);
            respond($state);
        }

        $paymentSplit = paymentSplitFromPost();
        $cost = [
            'id' => uuid(),
            'title' => $title,
            'area' => cleanText($_POST['area'] ?? '', 'Stan surowy'),
            'category' => cleanText($_POST['category'] ?? '', 'Inne'),
            'amount' => $amount,
            'payer' => $paymentSplit['payer'],
            'investorShare' => $paymentSplit['investorShare'],
            'partnerShare' => $paymentSplit['partnerShare'],
            'commentHtml' => cleanRichText($_POST['commentHtml'] ?? ''),
            'status' => $status,
            'paidDate' => $status === 'paid' ? cleanText($_POST['paidDate'] ?? '', date('Y-m-d')) : '',
            'attachments' => $attachments,
        ];

        syncCostWalletTransaction($state, $cost, isChecked($_POST['useWallet'] ?? ''));
        array_unshift($state['costs'], $cost);
        writeState($dataFile, $state);
        respond($cost, 201);
    }

    if ($resource === 'costs' && $method === 'PATCH' && $action === 'toggle') {
        foreach ($state['costs'] as &$cost) {
            if (($cost['id'] ?? '') === $id) {
                $currentStatus = cleanCostStatus($cost['status'] ?? '');
                if ($currentStatus === 'planned') {
                    $cost['status'] = 'unpaid';
                    $cost['paidDate'] = '';
                } elseif ($currentStatus === 'paid') {
                    $cost['status'] = 'unpaid';
                    $cost['paidDate'] = '';
                } else {
                    $cost['status'] = 'paid';
                    $cost['paidDate'] = date('Y-m-d');
                }
                syncCostWalletTransaction($state, $cost, false);
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

        if (is_array($deleted)) {
            $walletTransactionId = cleanText($deleted['walletTransactionId'] ?? '');
            if ($walletTransactionId !== '') {
                $state['wallet'] = normalizeWallet($state['wallet'] ?? []);
                $state['wallet']['transactions'] = array_values(array_filter(
                    $state['wallet']['transactions'],
                    static function (array $transaction) use ($walletTransactionId): bool {
                        return (string)($transaction['id'] ?? '') !== $walletTransactionId;
                    }
                ));
            }
            deleteAttachmentFiles(costAttachments($deleted));
        }

        writeState($dataFile, $state);
        respond($state);
    }

    respond(['message' => 'Nieznana akcja API.'], 404);
} catch (Throwable $error) {
    respond(['message' => 'Wystapil blad serwera.'], 500);
}
