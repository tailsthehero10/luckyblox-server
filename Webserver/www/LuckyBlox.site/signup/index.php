<?php
require_once __DIR__ . '/../../api/luckyblox-data.php';

$errors = array();
$currentUser = lb_get_current_user();
if ($currentUser) {
    header('Location: /LuckBlox.site.tk/home');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!lb_verify_csrf()) {
        $errors[] = 'Security token missing or invalid. Please reload and try again.';
    } else {
        $username = trim($_POST['username'] ?? '');
        $displayName = trim($_POST['displayName'] ?? '');
        $password = $_POST['password'] ?? '';
        $confirmPassword = $_POST['confirmPassword'] ?? '';

        $result = lb_signup($username, $password, $confirmPassword, $displayName);
        if ($result['ok']) {
            header('Location: /LuckBlox.site.tk/home?welcome=1');
            exit;
        } else {
            $errors = array_merge($errors, $result['errors']);
        }
    }
}

$csrfToken = lb_get_csrf_token();
$username = htmlspecialchars($_POST['username'] ?? '');
$displayName = htmlspecialchars($_POST['displayName'] ?? '');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LuckyBlox Sign Up</title>
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

        <h1>Create account</h1>
        <p class="subtitle">Sign up to create your local LuckyBlox account and start playing.</p>

        <?php if (!empty($errors)): ?>
            <div class="status error" aria-live="polite">
                <?php foreach ($errors as $error): ?>
                    <div><?php echo htmlspecialchars($error); ?></div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <form id="signupForm" method="POST" action="/LuckBlox.site/signup/">
            <input type="hidden" name="_csrf" value="<?php echo htmlspecialchars($csrfToken); ?>" />

            <label for="username">Username</label>
            <input type="text" id="username" name="username" value="<?php echo $username; ?>" placeholder="Choose a username" required autofocus />
            <div style="font-size:0.8rem;color:#94a3b8;">3-20 characters: letters, numbers, and underscores.</div>

            <label for="displayName">Display name</label>
            <input type="text" id="displayName" name="displayName" value="<?php echo $displayName; ?>" placeholder="Optional: display name" />

            <label for="password">Password</label>
            <input type="password" id="password" name="password" placeholder="Create a password" required />
            <div style="font-size:0.8rem;color:#94a3b8;">At least 8 chars with a lowercase letter, uppercase letter, and a number.</div>

            <label for="confirmPassword">Confirm password</label>
            <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Confirm your password" required />

            <div class="actions">
                <button type="submit">Create account</button>
                <button type="button" class="secondary" onclick="location.href='/LuckBlox.site/signin/'">Use sign in</button>
            </div>
        </form>

        <div class="links">
            <a href="/LuckBlox.site.tk/home">Back to dashboard</a>
        </div>
    </div>
</body>
</html>
