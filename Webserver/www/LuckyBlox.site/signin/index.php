<?php
require_once __DIR__ . '/../../api/luckyblox-data.php';

$errors = array();
$success = '';

$currentUser = lb_get_current_user();
$redirect = isset($_GET['redirect']) ? preg_replace('/^[^:\/]*:\/\//', '/', $_GET['redirect']) : '/LuckBlox.site/home';
if (strpos($redirect, '/') !== 0) {
    $redirect = '/LuckBlox.site/home';
}

if ($currentUser) {
    header('Location: ' . $redirect);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!lb_verify_csrf()) {
        $errors[] = 'Security token missing or invalid. Please reload and try again.';
    } else {
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';

        $result = lb_signin($username, $password);
        if ($result['ok']) {
            header('Location: ' . $redirect . '?signedin=1');
            exit;
        } else {
            $errors = array_merge($errors, $result['errors']);
        }
    }
}

$csrfToken = lb_get_csrf_token();
$username = htmlspecialchars($_POST['username'] ?? (isset($_GET['username']) ? $_GET['username'] : ''));
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LuckyBlox Sign In</title>
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
            background: url('/site-icon/BackgroundSigninup/sign page.jpg') no-repeat center center fixed;
            background-size: cover;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .card {
            background: rgba(15, 23, 42, 0.92);
            border: 1px solid #334155;
            border-radius: 14px;
            padding: 32px;
            box-shadow: 0 15px 30px rgba(0, 0, 0, 0.35);
            width: 100%;
            max-width: 420px;
        }
        .brand {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 24px;
        }
        .brand img { width: 32px; height: 32px; }
        .brand span { font-weight: 700; font-size: 1.5rem; color: #7dd3fc; letter-spacing: 0.04em; }
        h1 { margin: 0 0 8px; color: #e2e8f0; font-size: 1.5rem; }
        p.subtitle { margin: 0 0 20px; color: #94a3b8; font-size: 0.9rem; }
        form { display: grid; gap: 16px; }
        label { display: grid; gap: 6px; color: #cbd5e1; font-size: 0.85rem; }
        input { font: inherit; padding: 12px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; width: 100%; }
        button { padding: 12px; border-radius: 8px; border: none; background: #2563eb; color: #fff; font-weight: 700; cursor: pointer; font-size: 0.95rem; }
        button:hover { background: #1d4ed8; }
        .button.secondary { background: #0f766e; }
        .button.secondary:hover { background: #0d5b54; }
        .actions { display: flex; gap: 12px; margin-top: 8px; }
        .status { margin-top: 14px; min-height: 18px; font-size: 0.9rem; }
        .status.error { color: #fca5a5; }
        a { color: #7dd3fc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .links { margin-top: 18px; text-align: center; font-size: 0.9rem; }
    </style>
</head>
<body>
    <div class="card">
        <div class="brand">
            <img src="/site-icon/luckyblox.png" alt="LuckyBlox" />
            <span>LuckyBlox</span>
        </div>

        <h1>Sign in</h1>
        <p class="subtitle">Sign in with your LuckyBlox account to access your games, profile, and settings.</p>

        <?php if (!empty($errors)): ?>
            <div class="status error" aria-live="polite">
                <?php foreach ($errors as $error): ?>
                    <div><?php echo htmlspecialchars($error); ?></div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <form id="signinForm" method="POST" action="/LuckBlox.site/signin/?redirect=<?php echo rawurlencode($redirect); ?>">
            <input type="hidden" name="_csrf" value="<?php echo htmlspecialchars($csrfToken); ?>" />

            <label for="username">Username</label>
            <input type="text" id="username" name="username" value="<?php echo $username; ?>" placeholder="Enter your username" required autofocus />

            <label for="password">Password</label>
            <input type="password" id="password" name="password" placeholder="Enter your password" required />

            <div class="actions">
                <button type="submit">Sign in</button>
                <button type="button" class="secondary" onclick="location.href='/LuckBlox.site/signup/'">Create account</button>
            </div>
        </form>

        <div class="links">
            <a href="/LuckBlox.site/home">Back to dashboard</a>
        </div>
    </div>
</body>
</html>
