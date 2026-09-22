<?php
require_once __DIR__ . '/common.php';

$statsRoot = api_settings_root() . '/stats';
$summary = array(
    'visits' => 0,
    'loads' => 0,
    'saves' => 0,
    'publishes' => 0,
    'places' => 0,
    'lastUpdatedAt' => null,
);

if (is_dir($statsRoot)) {
    $files = glob($statsRoot . '/*.json');
    if (is_array($files)) {
        $summary['places'] = count($files);

        foreach ($files as $file) {
            $data = api_read_json_file($file);
            if (!is_array($data)) {
                continue;
            }

            $summary['visits'] += (int) ($data['visits'] ?? 0);
            $summary['loads'] += (int) ($data['loads'] ?? 0);
            $summary['saves'] += (int) ($data['saves'] ?? 0);
            $summary['publishes'] += (int) ($data['publishes'] ?? 0);

            $updatedAt = $data['lastSavedAt'] ?? $data['lastPublishedAt'] ?? $data['lastLoadedAt'] ?? $data['lastVisitedAt'] ?? null;
            if ($updatedAt !== null && ($summary['lastUpdatedAt'] === null || $updatedAt > $summary['lastUpdatedAt'])) {
                $summary['lastUpdatedAt'] = $updatedAt;
            }
        }
    }
}

api_json_response(array(
    'ok' => true,
    'backend' => 'LuckyBlox Launcher Backend',
    'summary' => $summary,
    'updatedAt' => date('c'),
));
