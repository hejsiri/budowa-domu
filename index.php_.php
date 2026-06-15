<?php
declare(strict_types=1);

$dataDir = __DIR__ . '/server/data';
$uploadsDir = __DIR__ . '/server/uploads';
$dataFile = $dataDir . '/budowa.json';
$today = date('Y-m-d');

function uuid(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function initialState(): array
{
    return [
        'tasks' => [
            [
                'id' => uuid(),
                'title' => 'Zamówić kierownika budowy na odbiór zbrojenia',
                'area' => 'Fundamenty',
                'priority' => 'Pilne',
                'dueDate' => '2026-06-18',
                'status' => 'todo',
            ],
            [
                'id' => uuid(),
                'title' => 'Sprawdzić wycenę bloczków i transportu',
                'area' => 'Materiały',
                'priority' => 'Normalne',
                'dueDate' => '2026-06-21',
                'status' => 'todo',
            ],
            [
                'id' => uuid(),
                'title' => 'Zapisać pomiar geodety do dokumentów',
                'area' => 'Dokumenty',
                'priority' => 'Normalne',
                'dueDate' => '2026-06-10',
                'status' => 'done',
            ],
        ],
        'costs' => [
            [
                'id' => uuid(),
                'title' => 'Mapa do celów projektowych',
                'category' => 'Dokumenty',
                'amount' => 850,
                'status' => 'paid',
                'paidDate' => '2026-06-05',
            ],
            [
                'id' => uuid(),
                'title' => 'Zaliczka za stal zbrojeniową',
                'category' => 'Materiały',
                'amount' => 6400,
                'status' => 'unpaid',
                'paidDate' => '',
            ],
        ],
    ];
}

function ensureStorage(string $dataDir, string $uploadsDir, string $dataFile): void
{
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0775, true);
    }
    if (!is_dir($uploadsDir)) {
        mkdir($uploadsDir, 0775, true);
    }
    if (!is_file($dataFile)) {
        saveState($dataFile, initialState());
    }
}

function readState(string $dataFile): array
{
    $state = json_decode((string)file_get_contents($dataFile), true);
    if (!is_array($state)) {
        return ['tasks' => [], 'costs' => []];
    }

    $state['tasks'] = $state['tasks'] ?? [];
    $state['costs'] = $state['costs'] ?? [];
    return $state;
}

function saveState(string $dataFile, array $state): void
{
    file_put_contents($dataFile, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function textValue(string $key, string $fallback = ''): string
{
    $value = trim((string)($_POST[$key] ?? ''));
    return $value !== '' ? $value : $fallback;
}

function h(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

function money(float|int $value): string
{
    return number_format(round((float)$value), 0, ',', ' ') . ' zł';
}

function redirectHome(): never
{
    header('Location: index.php');
    exit;
}

function findCostAttachment(array $state, string $id): ?array
{
    foreach ($state['costs'] as $cost) {
        if (($cost['id'] ?? '') === $id) {
            return $cost['attachment'] ?? null;
        }
    }

    return null;
}

function priorityClass(string $priority): string
{
    return match (mb_strtolower($priority)) {
        'pilne' => 'urgent',
        'niskie' => 'low',
        default => 'normal',
    };
}

ensureStorage($dataDir, $uploadsDir, $dataFile);
$state = readState($dataFile);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = (string)($_POST['action'] ?? '');
    $id = (string)($_POST['id'] ?? '');

    if ($action === 'add_task') {
        $title = textValue('title');
        if ($title !== '') {
            array_unshift($state['tasks'], [
                'id' => uuid(),
                'title' => $title,
                'area' => textValue('area', 'Inne'),
                'priority' => textValue('priority', 'Normalne'),
                'dueDate' => textValue('dueDate'),
                'status' => 'todo',
            ]);
        }
    }

    if ($action === 'toggle_task') {
        foreach ($state['tasks'] as &$task) {
            if (($task['id'] ?? '') === $id) {
                $task['status'] = ($task['status'] ?? 'todo') === 'todo' ? 'done' : 'todo';
            }
        }
        unset($task);
    }

    if ($action === 'delete_task') {
        $state['tasks'] = array_values(array_filter(
            $state['tasks'],
            static fn(array $task): bool => ($task['id'] ?? '') !== $id
        ));
    }

    if ($action === 'add_cost') {
        $amount = (float)str_replace(',', '.', (string)($_POST['amount'] ?? '0'));
        $title = textValue('title');
        $status = textValue('status', 'unpaid') === 'paid' ? 'paid' : 'unpaid';

        if ($title !== '' && $amount > 0) {
            $cost = [
                'id' => uuid(),
                'title' => $title,
                'category' => textValue('category', 'Inne'),
                'amount' => $amount,
                'status' => $status,
                'paidDate' => $status === 'paid' ? textValue('paidDate', date('Y-m-d')) : '',
            ];

            $uploadedInvoice = null;
            if (isset($_FILES['invoice']) && is_uploaded_file($_FILES['invoice']['tmp_name'])) {
                $uploadedInvoice = $_FILES['invoice'];
            }
            if (isset($_FILES['invoice_camera']) && is_uploaded_file($_FILES['invoice_camera']['tmp_name'])) {
                $uploadedInvoice = $_FILES['invoice_camera'];
            }

            if ($uploadedInvoice !== null) {
                $originalName = basename((string)$uploadedInvoice['name']);
                $extension = pathinfo($originalName, PATHINFO_EXTENSION);
                $baseName = preg_replace('/[^a-zA-Z0-9-]+/', '-', pathinfo($originalName, PATHINFO_FILENAME)) ?: 'faktura';
                $fileName = time() . '-' . trim(substr($baseName, 0, 60), '-') . ($extension ? '.' . $extension : '');
                $target = $uploadsDir . '/' . $fileName;

                if (move_uploaded_file($uploadedInvoice['tmp_name'], $target)) {
                    $cost['attachment'] = [
                        'name' => $originalName,
                        'path' => 'server/uploads/' . $fileName,
                        'mimeType' => (string)($uploadedInvoice['type'] ?? 'application/octet-stream'),
                    ];
                }
            }

            array_unshift($state['costs'], $cost);
        }
    }

    if ($action === 'toggle_cost') {
        foreach ($state['costs'] as &$cost) {
            if (($cost['id'] ?? '') === $id) {
                $isPaid = ($cost['status'] ?? 'unpaid') === 'paid';
                $cost['status'] = $isPaid ? 'unpaid' : 'paid';
                $cost['paidDate'] = $isPaid ? '' : date('Y-m-d');
            }
        }
        unset($cost);
    }

    if ($action === 'delete_cost') {
        $attachment = findCostAttachment($state, $id);
        $state['costs'] = array_values(array_filter(
            $state['costs'],
            static fn(array $cost): bool => ($cost['id'] ?? '') !== $id
        ));

        if (isset($attachment['path'])) {
            $path = __DIR__ . '/' . ltrim((string)$attachment['path'], '/');
            if (is_file($path)) {
                unlink($path);
            }
        }
    }

    saveState($dataFile, $state);
    redirectHome();
}

$todoTasks = array_values(array_filter($state['tasks'], static fn(array $task): bool => ($task['status'] ?? 'todo') === 'todo'));
$doneTasks = array_values(array_filter($state['tasks'], static fn(array $task): bool => ($task['status'] ?? 'todo') === 'done'));
$unpaidCosts = array_values(array_filter($state['costs'], static fn(array $cost): bool => ($cost['status'] ?? 'unpaid') === 'unpaid'));
$paidCosts = array_values(array_filter($state['costs'], static fn(array $cost): bool => ($cost['status'] ?? 'unpaid') === 'paid'));
$paidSum = array_sum(array_map(static fn(array $cost): float => (float)$cost['amount'], $paidCosts));
$unpaidSum = array_sum(array_map(static fn(array $cost): float => (float)$cost['amount'], $unpaidCosts));
$totalSum = $paidSum + $unpaidSum;
?>
<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Budowa domu</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css">
  <style>
    :root {
      color: #16201d;
      background: #f6f8fb;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 320px;
      background:
        radial-gradient(circle at top left, rgba(52, 211, 153, .12), transparent 32rem),
        radial-gradient(circle at top right, rgba(96, 165, 250, .14), transparent 34rem),
        #f6f8fb;
    }
    button, input, select { font: inherit; letter-spacing: 0; }
    button { cursor: pointer; }
    .shell { width: min(1500px, calc(100% - 40px)); margin: 0 auto; padding: 26px 0 34px; }
    .topbar, .brand, .workspace, .module-heading, .board, .column-head, .item-card, .item-title-row, .modal-head, .modal-actions { display: flex; }
    .topbar { align-items: center; gap: 20px; margin-bottom: 20px; }
    .brand { align-items: center; gap: 14px; }
    .brand-mark {
      display: grid;
      place-items: center;
      width: 50px;
      height: 50px;
      border-radius: 8px;
      color: #ffffff;
      background: linear-gradient(135deg, #2563eb, #14b8a6);
      font-weight: 900;
      box-shadow: 0 12px 28px rgba(37, 99, 235, .22);
    }
    .eyebrow, label span, .stat span, .column-kicker { margin: 0; color: #6b7280; font-size: .74rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1, h2, h3 { margin: 0; color: #111827; }
    h1 { font-size: clamp(2.15rem, 4vw, 4.1rem); line-height: 1.02; letter-spacing: -.02em; }
    h2 { margin-top: 5px; font-size: 1.2rem; letter-spacing: -.01em; }
    .stats { display: grid; grid-template-columns: 1.35fr repeat(2, 1fr); gap: 12px; margin-bottom: 18px; }
    .stat {
      min-height: 112px;
      padding: 18px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: rgba(255,255,255,.86);
      box-shadow: 0 16px 38px rgba(15, 23, 42, .05);
    }
    .stat.main { border-color: rgba(37, 99, 235, .2); background: linear-gradient(135deg, #ffffff, #eef6ff); }
    .stat.main span, .stat.main small { color: #4b5563; }
    .stat strong { display: block; margin: 14px 0 7px; color: #111827; font-size: clamp(1.45rem, 2.4vw, 2.15rem); line-height: 1; letter-spacing: -.02em; }
    .stat small { color: #6b7280; font-weight: 700; }
    .workspace { align-items: flex-start; gap: 18px; }
    .module {
      flex: 1 1 0;
      min-width: 0;
      padding: 20px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: rgba(255,255,255,.9);
      box-shadow: 0 18px 46px rgba(15, 23, 42, .06);
    }
    .module-heading { align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    .add-button, .primary { min-height: 40px; border: 0; border-radius: 8px; padding: 0 15px; color: #fff; background: #2563eb; font-weight: 850; box-shadow: 0 12px 24px rgba(37, 99, 235, .18); }
    .add-button { flex: 0 0 auto; }
    .board { flex-direction: column; gap: 24px; align-items: stretch; }
    .column {
      min-width: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }
    .column + .column { padding-top: 22px; border-top: 1px solid #eef2f7; }
    .column-head { align-items: center; justify-content: space-between; gap: 10px; padding: 0 0 10px; border-bottom: 0; background: transparent; }
    .column-head h3 { margin-top: 4px; font-size: 1.02rem; letter-spacing: -.01em; }
    .count { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; border-radius: 999px; color: #1d4ed8; background: #dbeafe; font-weight: 900; }
    .list { display: grid; gap: 9px; padding: 0; }
    .item-card {
      align-items: flex-start;
      gap: 11px;
      padding: 13px;
      border: 1px solid #edf0f4;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 8px 22px rgba(15, 23, 42, .035);
    }
    .item-main { min-width: 0; flex: 1; }
    .item-title-row { align-items: flex-start; justify-content: space-between; gap: 12px; }
    .item-card h4 { margin: 0; color: #111827; font-size: .98rem; line-height: 1.28; font-weight: 780; }
    .item-card p, .empty { margin: 7px 0 0; color: #6b7280; font-size: .91rem; font-weight: 650; }
    .empty { padding: 18px; border: 1px dashed #d1d5db; border-radius: 8px; text-align: center; background: #fff; }
    .badge { flex: 0 0 auto; border-radius: 999px; padding: 4px 9px; color: #047857; background: #d1fae5; font-size: .72rem; font-weight: 900; }
    .badge.urgent { color: #b42318; background: #fee4e2; }
    .badge.low { color: #92400e; background: #fef3c7; }
    .status, .danger { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; border: 0; font-weight: 900; }
    .status { border: 2px solid #cbd5e1; color: #fff; background: #fff; }
    .status.done, .status.paid { border-color: #10b981; background: #10b981; }
    .danger { color: #9f1239; background: #ffe4e6; }
    .inline-form { margin: 0; }
    .amount { color: #1d4ed8; white-space: nowrap; }
    .attachment { display: inline-flex; margin-top: 10px; color: #2563eb; font-weight: 850; text-decoration: none; }
    dialog { width: min(720px, calc(100% - 24px)); border: 0; border-radius: 8px; padding: 0; color: #111827; background: #fff; box-shadow: 0 30px 90px rgba(15,23,42,.28); }
    dialog::backdrop { background: rgba(15,23,42,.42); backdrop-filter: blur(3px); }
    .modal-head { align-items: flex-start; justify-content: space-between; gap: 18px; padding: 20px; border-bottom: 1px solid #e5e7eb; }
    .close-button { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 8px; color: #4b5563; background: #f3f4f6; font-size: 1.4rem; line-height: 1; }
    .form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; padding: 20px; }
    .wide { grid-column: 1 / -1; }
    label { display: grid; grid-template-rows: 18px auto; gap: 7px; min-width: 0; }
    input, select {
      width: 100%;
      height: 44px;
      min-height: 44px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 0 12px;
      color: #111827;
      background: #fff;
      outline: none;
      line-height: 44px;
    }
    select { appearance: auto; }
    input:focus, select:focus { border-color: #2563eb; box-shadow: 0 0 0 4px rgba(37,99,235,.13); }
    .flatpickr-input[readonly] { background: #fff; cursor: pointer; }
    .flatpickr-calendar {
      width: 340px;
      border: 1px solid #dbe3ef;
      border-radius: 8px;
      box-shadow: 0 24px 70px rgba(15, 23, 42, .22);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }
    .flatpickr-months {
      padding: 8px 8px 0;
    }
    .flatpickr-current-month {
      font-size: 1rem;
      font-weight: 850;
    }
    .flatpickr-weekday {
      color: #64748b;
      font-size: .82rem;
      font-weight: 850;
    }
    .flatpickr-day {
      max-width: 42px;
      height: 42px;
      line-height: 42px;
      border-radius: 8px;
      color: #111827;
      font-weight: 700;
    }
    .flatpickr-day.today {
      border-color: #2563eb;
    }
    .flatpickr-day.selected,
    .flatpickr-day.startRange,
    .flatpickr-day.endRange {
      border-color: #2563eb;
      background: #2563eb;
    }
    .flatpickr-day:hover {
      background: #eff6ff;
      border-color: #bfdbfe;
    }
    .dropzone {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 132px;
      border: 1.5px dashed #c7d2fe;
      border-radius: 8px;
      padding: 18px;
      color: #4b5563;
      background: #f8fbff;
      text-align: center;
      transition: border-color .18s ease, background .18s ease, box-shadow .18s ease;
    }
    .dropzone:hover,
    .dropzone.is-dragover {
      border-color: #2563eb;
      background: #eff6ff;
      box-shadow: 0 0 0 4px rgba(37, 99, 235, .1);
    }
    .dropzone input[type=file] {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
    }
    .dropzone strong {
      display: block;
      margin-bottom: 5px;
      color: #111827;
      font-size: .98rem;
    }
    .dropzone small {
      display: block;
      color: #6b7280;
      font-weight: 650;
    }
    .dropzone-file {
      display: inline-flex;
      max-width: 100%;
      margin-top: 12px;
      border-radius: 999px;
      padding: 6px 10px;
      color: #1d4ed8;
      background: #dbeafe;
      font-size: .86rem;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .upload-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;
    }
    .camera-upload {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 0 14px;
      color: #1d4ed8;
      background: #eff6ff;
      font-weight: 850;
      overflow: hidden;
    }
    .camera-upload input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .modal-actions { grid-column: 1 / -1; justify-content: flex-end; gap: 10px; padding-top: 4px; }
    .secondary { min-height: 42px; border: 1px solid #d1d5db; border-radius: 8px; padding: 0 16px; color: #374151; background: #fff; font-weight: 850; }
    body {
      background:
        radial-gradient(circle at 8% 8%, rgba(20, 184, 166, .42), transparent 28rem),
        radial-gradient(circle at 82% 0%, rgba(59, 130, 246, .46), transparent 32rem),
        radial-gradient(circle at 76% 78%, rgba(168, 85, 247, .34), transparent 30rem),
        radial-gradient(circle at 20% 88%, rgba(34, 197, 94, .22), transparent 26rem),
        linear-gradient(135deg, #07111f 0%, #102036 44%, #101827 100%);
      background-attachment: fixed;
    }
    .shell {
      width: min(1440px, calc(100% - 48px));
      padding-top: 30px;
    }
    .brand-mark {
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, #2563eb, #14b8a6);
      box-shadow: 0 14px 34px rgba(20, 184, 166, .24);
      font-size: .9rem;
    }
    .brand {
      gap: 12px;
    }
    .eyebrow,
    label span,
    .stat span,
    .column-kicker {
      color: rgba(226, 232, 240, .72);
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: none;
    }
    h1 {
      color: #f8fafc;
      font-size: clamp(2rem, 3.2vw, 3.3rem);
      font-weight: 760;
      letter-spacing: -.035em;
    }
    h2 {
      color: #111827;
      font-size: 1.08rem;
      font-weight: 720;
    }
    .stat span,
    .module .eyebrow,
    .column-kicker,
    label span {
      color: #6b7280;
    }
    .brand .eyebrow {
      color: rgba(226, 232, 240, .72);
    }
    .stats {
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat {
      min-height: 98px;
      padding: 16px 18px;
      border-color: rgba(255,255,255,.56);
      background: rgba(255,255,255,.78);
      box-shadow: 0 18px 44px rgba(0, 0, 0, .16);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .stat.main {
      border-color: rgba(191, 219, 254, .74);
      background: rgba(239, 246, 255, .82);
    }
    .stat strong {
      margin: 10px 0 5px;
      font-size: clamp(1.45rem, 2.2vw, 2rem);
      font-weight: 760;
    }
    .stat small {
      color: #717887;
      font-weight: 600;
    }
    .workspace {
      gap: 16px;
    }
    .module {
      padding: 18px;
      border-color: rgba(255,255,255,.58);
      background: rgba(255,255,255,.82);
      box-shadow: 0 22px 54px rgba(0, 0, 0, .18);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    .module-heading {
      margin-bottom: 18px;
      padding-bottom: 2px;
    }
    .add-button,
    .primary {
      min-height: 38px;
      border: 0;
      color: #fff;
      background: linear-gradient(135deg, #2563eb, #14b8a6);
      font-weight: 720;
      box-shadow: 0 14px 30px rgba(37, 99, 235, .22);
    }
    .primary {
      color: #fff;
      background: linear-gradient(135deg, #2563eb, #14b8a6);
    }
    .board {
      gap: 22px;
    }
    .column + .column {
      border-top-color: #edf1f6;
    }
    .column-head {
      padding-bottom: 9px;
    }
    .column-head h3 {
      font-size: 1rem;
      font-weight: 720;
    }
    .count {
      min-width: 26px;
      height: 26px;
      color: #475569;
      background: #f1f5f9;
      font-size: .88rem;
      font-weight: 760;
    }
    .item-card {
      align-items: center;
      min-height: 58px;
      padding: 11px 12px;
      border-color: rgba(226, 232, 240, .86);
      box-shadow: 0 10px 24px rgba(15, 23, 42, .055);
    }
    .item-card h4 {
      font-size: .95rem;
      font-weight: 700;
    }
    .item-card p,
    .empty {
      color: #717887;
      font-size: .88rem;
      font-weight: 560;
    }
    .badge {
      background: #eefbf4;
      color: #15803d;
      font-size: .7rem;
      font-weight: 720;
    }
    .badge.urgent {
      color: #b42318;
      background: #fff1f0;
    }
    .badge.low {
      color: #9a6700;
      background: #fff8db;
    }
    .status,
    .danger {
      width: 30px;
      height: 30px;
    }
    .status {
      border-color: #d5dce8;
    }
    .status.done,
    .status.paid {
      border-color: #22c55e;
      background: #22c55e;
    }
    .danger {
      color: #be123c;
      background: #ffe4e8;
    }
    .amount,
    .attachment {
      color: #2563eb;
      font-weight: 720;
    }
    dialog {
      background: rgba(255,255,255,.9);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: 0 30px 90px rgba(0,0,0,.34);
    }
    .dropzone {
      min-height: 118px;
      border-color: #d7deea;
      background: #fafbfc;
    }
    .dropzone:hover,
    .dropzone.is-dragover {
      border-color: #94a3b8;
      background: #f8fafc;
      box-shadow: none;
    }
    .dropzone-file {
      color: #334155;
      background: #eef2f7;
      font-weight: 700;
    }
    .camera-upload {
      color: #334155;
      border-color: #d7deea;
      background: #fff;
      font-weight: 720;
    }
    @media (max-width: 1260px) { .workspace, .topbar { flex-direction: column; align-items: stretch; } .stats { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 760px) { .shell { width: min(100% - 20px, 1480px); padding-top: 18px; } .stats, .form { grid-template-columns: 1fr; } .module, .stat { padding: 15px; } .module-heading, .item-title-row { flex-direction: column; align-items: flex-start; } .add-button { width: 100%; } .wide { grid-column: auto; } .modal-actions { flex-direction: column-reverse; } .modal-actions button { width: 100%; } }

    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Fraunces:wght@600;700&display=swap');
    :root {
      color: #151b20;
      background: #f3f6f8;
      font-family: "DM Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      background:
        linear-gradient(180deg, rgba(231, 238, 243, .78), rgba(247, 249, 250, .84)),
        #f3f6f8;
    }
    .shell {
      width: 100%;
      min-height: 100vh;
      padding: 0 0 38px;
    }
    .page-hero {
      position: relative;
      overflow: hidden;
      padding: 42px 28px 58px;
      color: #fff;
      text-align: center;
      background:
        linear-gradient(135deg, rgba(12, 38, 66, .98), rgba(24, 76, 112, .96)),
        #0c2642;
    }
    .page-hero::before {
      position: absolute;
      inset: 0;
      content: "";
      background: repeating-linear-gradient(-45deg, transparent, transparent 18px, rgba(255,255,255,.055) 18px, rgba(255,255,255,.055) 19px);
    }
    .topbar {
      position: relative;
      z-index: 1;
      justify-content: center;
      margin: 0;
    }
    .brand {
      flex-direction: column;
      gap: 9px;
      text-align: center;
    }
    .brand-mark {
      width: 54px;
      height: 54px;
      border: 1px solid rgba(255,255,255,.2);
      background: rgba(255,255,255,.13);
      box-shadow: 0 18px 38px rgba(4, 17, 31, .2);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .brand .eyebrow {
      color: rgba(255,255,255,.76);
      font-size: .72rem;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    h1 {
      color: #fff;
      font-family: Fraunces, Georgia, serif;
      font-size: clamp(2.4rem, 6vw, 4.7rem);
      font-weight: 700;
      line-height: 1.06;
      letter-spacing: 0;
    }
    h2,
    .column-head h3 {
      color: #151b20;
      font-family: Fraunces, Georgia, serif;
      font-weight: 700;
      letter-spacing: 0;
    }
    .stats {
      position: relative;
      z-index: 1;
      width: min(1040px, 100%);
      grid-template-columns: 1.45fr repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 30px auto 0;
    }
    .stat,
    .stat.main {
      min-height: 124px;
      padding: 18px;
      border: 1px solid rgba(255,255,255,.18);
      background: rgba(255,255,255,.12);
      box-shadow: 0 18px 40px rgba(4,17,31,.16);
      text-align: left;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .stat.main {
      background: rgba(255,255,255,.18);
    }
    .stat span,
    .stat.main span,
    .stat small,
    .stat.main small {
      color: rgba(255,255,255,.68);
      font-size: .72rem;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .stat strong {
      color: #fff;
      font-family: Fraunces, Georgia, serif;
      font-size: clamp(1.65rem, 3vw, 2.5rem);
      font-weight: 700;
      letter-spacing: 0;
    }
    .workspace {
      width: min(1040px, calc(100% - 32px));
      align-items: flex-start;
      gap: 18px;
      margin: 28px auto 0;
    }
    .module {
      overflow: hidden;
      padding: 0;
      border: 1px solid #d9e2e8;
      background: #fff;
      box-shadow: 0 18px 45px rgba(12, 38, 66, .1);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    .module-heading {
      align-items: center;
      margin: 0;
      padding: 18px 20px;
      border-bottom: 1px solid #d9e2e8;
      background: #f8faf7;
    }
    .module .eyebrow,
    .column-kicker,
    label span {
      color: #697683;
      font-size: .72rem;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .board {
      gap: 18px;
      padding: 16px;
    }
    .column + .column {
      border-top-color: #e7edf1;
    }
    .item-card {
      min-height: 0;
      align-items: flex-start;
      border-color: #d9e2e8;
      box-shadow: none;
      transition: border-color .2s, box-shadow .2s, transform .2s;
    }
    .item-card:hover {
      border-color: #c5d0d8;
      box-shadow: 0 10px 24px rgba(12,38,66,.08);
      transform: translateY(-2px);
    }
    .add-button,
    .primary {
      min-height: 42px;
      background: #0c2642;
      font-weight: 900;
      box-shadow: 0 14px 26px rgba(12,38,66,.18);
      white-space: nowrap;
    }
    .add-button:hover,
    .primary:hover {
      background: #256387;
    }
    .count,
    .badge {
      color: #0c2642;
      background: #e8f0f5;
    }
    .status.done,
    .status.paid {
      border-color: #256387;
      background: #256387;
    }
    .amount,
    .attachment {
      color: #256387;
    }
    input,
    select {
      border-color: #d9e2e8;
      font-weight: 600;
    }
    input:focus,
    select:focus {
      border-color: #256387;
      box-shadow: 0 0 0 4px rgba(37,99,135,.14);
    }
    dialog {
      border: 1px solid #d9e2e8;
      background: #fff;
      box-shadow: 0 30px 90px rgba(12,38,66,.28);
    }
    .flatpickr-calendar {
      font-family: "DM Sans", Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .flatpickr-day.today,
    .flatpickr-day.selected,
    .flatpickr-day.startRange,
    .flatpickr-day.endRange {
      border-color: #256387;
      background: #256387;
    }
    @media (max-width: 1260px) {
      .topbar {
        align-items: center;
      }
      .workspace {
        flex-direction: column;
        align-items: stretch;
      }
    }
    @media (max-width: 760px) {
      .shell {
        width: 100%;
        padding-top: 0;
      }
      .page-hero {
        padding: 34px 14px 38px;
      }
      .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .stat {
        min-height: 112px;
        padding: 14px;
      }
      .stat strong {
        font-size: 1.5rem;
      }
      .workspace {
        width: min(100% - 20px, 1040px);
      }
      .form {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
<main class="shell">
  <header class="page-hero">
  <div class="topbar">
    <div class="brand">
      <span class="brand-mark">BD</span>
      <div>
        <p class="eyebrow">Panel inwestora</p>
        <h1>Budowa domu</h1>
      </div>
    </div>
  </div>

  <section class="stats">
    <article class="stat main"><span>Suma kosztów</span><strong><?= money($totalSum) ?></strong><small>Zapłacone i do zapłaty</small></article>
    <article class="stat"><span>Do zapłaty</span><strong><?= money($unpaidSum) ?></strong><small><?= count($unpaidCosts) ?> pozycji</small></article>
    <article class="stat"><span>Zapłacone</span><strong><?= money($paidSum) ?></strong><small><?= count($paidCosts) ?> pozycji</small></article>
  </section>
  </header>

  <section class="workspace">
    <section class="module">
      <div class="module-heading">
        <div><p class="eyebrow">Zadania budowy</p><h2>Do zrobienia i zrobione</h2></div>
        <button class="add-button" type="button" data-open-modal="taskModal">Dodaj zadanie</button>
      </div>

      <div class="board">
        <section class="column">
          <div class="column-head">
            <div><p class="column-kicker">Zadania</p><h3>Do zrobienia</h3></div>
            <span class="count"><?= count($todoTasks) ?></span>
          </div>
          <div class="list">
            <?php if (!$todoTasks): ?><p class="empty">Brak zadań do wykonania.</p><?php endif; ?>
            <?php foreach ($todoTasks as $task): ?>
              <article class="item-card">
                <form class="inline-form" method="post">
                  <input type="hidden" name="action" value="toggle_task">
                  <input type="hidden" name="id" value="<?= h($task['id'] ?? '') ?>">
                  <button class="status" title="Oznacz jako zrobione"></button>
                </form>
                <div class="item-main">
                  <div class="item-title-row">
                    <h4><?= h($task['title'] ?? '') ?></h4>
                    <span class="badge <?= priorityClass((string)($task['priority'] ?? '')) ?>"><?= h($task['priority'] ?? '') ?></span>
                  </div>
                  <p><?= h($task['area'] ?? '') ?> · termin <?= h($task['dueDate'] ?: 'bez daty') ?></p>
                </div>
                <form class="inline-form delete-form" method="post" data-confirm="Usunąć to zadanie?">
                  <input type="hidden" name="action" value="delete_task">
                  <input type="hidden" name="id" value="<?= h($task['id'] ?? '') ?>">
                  <button class="danger" title="Usuń zadanie">×</button>
                </form>
              </article>
            <?php endforeach; ?>
          </div>
        </section>

        <section class="column">
          <div class="column-head">
            <div><p class="column-kicker">Zadania</p><h3>Zrobione</h3></div>
            <span class="count"><?= count($doneTasks) ?></span>
          </div>
          <div class="list">
            <?php if (!$doneTasks): ?><p class="empty">Jeszcze nic nie jest oznaczone jako zrobione.</p><?php endif; ?>
            <?php foreach ($doneTasks as $task): ?>
              <article class="item-card">
                <form class="inline-form" method="post">
                  <input type="hidden" name="action" value="toggle_task">
                  <input type="hidden" name="id" value="<?= h($task['id'] ?? '') ?>">
                  <button class="status done" title="Przywróć do zrobienia">✓</button>
                </form>
                <div class="item-main">
                  <div class="item-title-row">
                    <h4><?= h($task['title'] ?? '') ?></h4>
                    <span class="badge <?= priorityClass((string)($task['priority'] ?? '')) ?>"><?= h($task['priority'] ?? '') ?></span>
                  </div>
                  <p><?= h($task['area'] ?? '') ?> · termin <?= h($task['dueDate'] ?: 'bez daty') ?></p>
                </div>
                <form class="inline-form delete-form" method="post" data-confirm="Usunąć to zadanie?">
                  <input type="hidden" name="action" value="delete_task">
                  <input type="hidden" name="id" value="<?= h($task['id'] ?? '') ?>">
                  <button class="danger" title="Usuń zadanie">×</button>
                </form>
              </article>
            <?php endforeach; ?>
          </div>
        </section>
      </div>
    </section>

    <section class="module">
      <div class="module-heading">
        <div><p class="eyebrow">Koszty budowy</p><h2>Do zapłaty i zapłacone</h2></div>
        <button class="add-button" type="button" data-open-modal="costModal">Dodaj koszt</button>
      </div>

      <div class="board">
        <section class="column">
          <div class="column-head">
            <div><p class="column-kicker"><?= money($unpaidSum) ?></p><h3>Do zapłaty</h3></div>
            <span class="count"><?= count($unpaidCosts) ?></span>
          </div>
          <div class="list">
            <?php if (!$unpaidCosts): ?><p class="empty">Brak kosztów do zapłaty.</p><?php endif; ?>
            <?php foreach ($unpaidCosts as $cost): ?>
              <article class="item-card">
                <form class="inline-form" method="post">
                  <input type="hidden" name="action" value="toggle_cost">
                  <input type="hidden" name="id" value="<?= h($cost['id'] ?? '') ?>">
                  <button class="status" title="Oznacz jako zapłacone"></button>
                </form>
                <div class="item-main">
                  <div class="item-title-row">
                    <h4><?= h($cost['title'] ?? '') ?></h4>
                    <strong class="amount"><?= money((float)($cost['amount'] ?? 0)) ?></strong>
                  </div>
                  <p><?= h($cost['category'] ?? '') ?> · do zapłaty</p>
                  <?php if (isset($cost['attachment']['path'])): ?>
                    <a class="attachment" href="<?= h($cost['attachment']['path']) ?>" target="_blank"><?= h($cost['attachment']['name'] ?? 'Faktura') ?></a>
                  <?php endif; ?>
                </div>
                <form class="inline-form delete-form" method="post" data-confirm="Usunąć ten koszt?">
                  <input type="hidden" name="action" value="delete_cost">
                  <input type="hidden" name="id" value="<?= h($cost['id'] ?? '') ?>">
                  <button class="danger" title="Usuń koszt">×</button>
                </form>
              </article>
            <?php endforeach; ?>
          </div>
        </section>

        <section class="column">
          <div class="column-head">
            <div><p class="column-kicker"><?= money($paidSum) ?></p><h3>Zapłacone</h3></div>
            <span class="count"><?= count($paidCosts) ?></span>
          </div>
          <div class="list">
            <?php if (!$paidCosts): ?><p class="empty">Brak zapłaconych kosztów.</p><?php endif; ?>
            <?php foreach ($paidCosts as $cost): ?>
              <article class="item-card">
                <form class="inline-form" method="post">
                  <input type="hidden" name="action" value="toggle_cost">
                  <input type="hidden" name="id" value="<?= h($cost['id'] ?? '') ?>">
                  <button class="status paid" title="Przywróć do zapłaty">✓</button>
                </form>
                <div class="item-main">
                  <div class="item-title-row">
                    <h4><?= h($cost['title'] ?? '') ?></h4>
                    <strong class="amount"><?= money((float)($cost['amount'] ?? 0)) ?></strong>
                  </div>
                  <p><?= h($cost['category'] ?? '') ?> · zapłacone <?= h($cost['paidDate'] ?: 'bez daty') ?></p>
                  <?php if (isset($cost['attachment']['path'])): ?>
                    <a class="attachment" href="<?= h($cost['attachment']['path']) ?>" target="_blank"><?= h($cost['attachment']['name'] ?? 'Faktura') ?></a>
                  <?php endif; ?>
                </div>
                <form class="inline-form delete-form" method="post" data-confirm="Usunąć ten koszt?">
                  <input type="hidden" name="action" value="delete_cost">
                  <input type="hidden" name="id" value="<?= h($cost['id'] ?? '') ?>">
                  <button class="danger" title="Usuń koszt">×</button>
                </form>
              </article>
            <?php endforeach; ?>
          </div>
        </section>
      </div>
    </section>
  </section>
</main>

<dialog id="taskModal">
  <div class="modal-head">
    <div><p class="eyebrow">Nowe zadanie</p><h2>Dodaj zadanie budowy</h2></div>
    <button class="close-button" type="button" data-close-modal>×</button>
  </div>
  <form class="form" method="post">
    <input type="hidden" name="action" value="add_task">
    <label class="wide"><span>Nazwa zadania</span><input name="title" placeholder="np. Zamówić beton B25" required></label>
    <label><span>Etap</span><select name="area"><option>Fundamenty</option><option>Ściany</option><option>Dach</option><option>Instalacje</option><option>Wykończenie</option><option>Dokumenty</option><option>Materiały</option></select></label>
    <label><span>Priorytet</span><select name="priority"><option>Normalne</option><option>Pilne</option><option>Niskie</option></select></label>
    <label><span>Termin</span><input class="date-picker" type="text" name="dueDate" value="<?= h($today) ?>"></label>
    <div class="modal-actions">
      <button class="secondary" type="button" data-close-modal>Anuluj</button>
      <button class="primary" type="submit">Dodaj zadanie</button>
    </div>
  </form>
</dialog>

<dialog id="costModal">
  <div class="modal-head">
    <div><p class="eyebrow">Nowy koszt</p><h2>Dodaj koszt budowy</h2></div>
    <button class="close-button" type="button" data-close-modal>×</button>
  </div>
  <form class="form" method="post" enctype="multipart/form-data">
    <input type="hidden" name="action" value="add_cost">
    <label class="wide"><span>Opis kosztu</span><input name="title" placeholder="np. Transport bloczków" required></label>
    <label><span>Kategoria</span><select name="category"><option>Materiały</option><option>Robocizna</option><option>Sprzęt</option><option>Dokumenty</option><option>Transport</option><option>Inne</option></select></label>
    <label><span>Kwota PLN</span><input type="number" min="0" step="0.01" name="amount" placeholder="0,00" required></label>
    <label><span>Status</span><select name="status"><option value="unpaid">Do zapłaty</option><option value="paid">Zapłacone</option></select></label>
    <label><span>Kiedy zapłacono</span><input class="date-picker" type="text" name="paidDate"></label>
    <label class="wide"><span>Faktura</span>
      <div class="dropzone" data-dropzone>
        <input type="file" name="invoice" accept="image/*,.pdf">
        <div>
          <strong>Przeciągnij fakturę tutaj</strong>
          <small>albo kliknij, aby wybrać plik PDF lub zdjęcie</small>
          <span class="dropzone-file" data-file-name>Nie wybrano pliku</span>
          <div class="upload-actions">
            <span class="camera-upload">
              Zrób zdjęcie
              <input type="file" name="invoice_camera" accept="image/*" capture="environment" data-camera-input>
            </span>
          </div>
        </div>
      </div>
    </label>
    <div class="modal-actions">
      <button class="secondary" type="button" data-close-modal>Anuluj</button>
      <button class="primary" type="submit">Dodaj koszt</button>
    </div>
  </form>
</dialog>

<script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
<script src="https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/pl.js"></script>
<script>
  if (window.flatpickr) {
    flatpickr('.date-picker', {
      altInput: true,
      altFormat: 'd.m.Y',
      dateFormat: 'Y-m-d',
      disableMobile: true,
      locale: 'pl',
      monthSelectorType: 'static'
    });
  }

  document.querySelectorAll('[data-open-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById(button.dataset.openModal).showModal();
    });
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      button.closest('dialog').close();
    });
  });

  document.querySelectorAll('.delete-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!confirm(form.dataset.confirm || 'Na pewno usunąć tę pozycję?')) {
        event.preventDefault();
      }
    });
  });

  document.querySelectorAll('[data-dropzone]').forEach((dropzone) => {
    const input = dropzone.querySelector('input[type="file"]');
    const cameraInput = dropzone.querySelector('[data-camera-input]');
    const fileName = dropzone.querySelector('[data-file-name]');

    const updateFileName = (sourceInput = input) => {
      fileName.textContent = sourceInput.files.length ? sourceInput.files[0].name : 'Nie wybrano pliku';
    };

    input.addEventListener('change', () => updateFileName(input));
    cameraInput.addEventListener('change', () => updateFileName(cameraInput));

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.remove('is-dragover');
      });
    });

    dropzone.addEventListener('drop', (event) => {
      if (event.dataTransfer.files.length) {
        input.files = event.dataTransfer.files;
        updateFileName();
      }
    });
  });
</script>
</body>
</html>
