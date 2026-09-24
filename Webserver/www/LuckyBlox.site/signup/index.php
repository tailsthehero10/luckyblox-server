<?php
require_once __DIR__ . '/../../api/luckyblox-data.php';

$errors = array();

$currentUser = lb_get_current_user();
if ($currentUser) {
    header('Location: /LuckBlox.site/home');
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
        $gender = $_POST['gender'] ?? 'NotSpecified';

        $result = lb_signup($username, $password, $confirmPassword, $displayName, $gender);
        if ($result['ok']) {
            header('Location: /LuckBlox.site/home?welcome=1');
            exit;
        } else {
            $errors = array_merge($errors, $result['errors']);
        }
    }
}

$csrfToken = lb_get_csrf_token();
$usernameVal = htmlspecialchars($_POST['username'] ?? '');
$displayNameVal = htmlspecialchars($_POST['displayName'] ?? '');
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
            margin: 0; padding: 0; font-family: Arial, sans-serif;
            background: url('/site-icon/BackgroundSigninup/sign page.jpg') no-repeat center center fixed;
            background-size: cover; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .card {
            background: rgba(15, 23, 42, 0.92); border: 1px solid #334155; border-radius: 14px;
            padding: 32px; box-shadow: 0 15px 30px rgba(0,0,0,0.35); width: 100%; max-width: 420px;
        }
        .brand { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 24px; }
        .brand img { width: 32px; height: 32px; }
        .brand span { font-weight: 700; font-size: 1.5rem; color: #7dd3fc; letter-spacing: 0.04em; }
        h1 { margin: 0 0 8px; color: #e2e8f0; font-size: 1.5rem; }
        p.subtitle { margin: 0 0 20px; color: #94a3b8; font-size: 0.9rem; }
        form { display: grid; gap: 16px; }
        label { display: grid; gap: 6px; color: #cbd5e1; font-size: 0.85rem; }
        input, select { font: inherit; padding: 12px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; width: 100%; box-sizing: border-box; }
        select:focus, input:focus { outline: none; border-color: #5d8fe2; }
        button { padding: 12px; border-radius: 8px; border: none; background: #2563eb; color: #fff; font-weight: 700; cursor: pointer; font-size: 0.95rem; transition: background .15s; }
        button:hover { background: #1d4ed8; }
        .button.secondary { background: #0f766e; }
        .button.secondary:hover { background: #0d5b54; }
        .actions { display: flex; gap: 12px; margin-top: 8px; }
        .status { margin-top: 14px; min-height: 18px; font-size: 0.9rem; }
        .status.error { color: #fca5a5; }
        .hint { margin: 0 0 14px; padding: 8px 12px; border-radius: 8px; background: #eef5ff; border: 1px solid #c9ddff; color: #4a6fa5; font-size: 0.82rem; line-height: 1.5; }
        a { color: #7dd3fc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .links { margin-top: 18px; text-align: center; font-size: 0.9rem; color: #94a3b8; }
        .small { font-size: 0.8rem; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="card">
        <div class="brand">
            <img src="/site-icon/luckyblox.png" alt="LuckyBlox" />
            <span>LuckyBlox</span>
        </div>

        <h1>Create account</h1>
        <p class="subtitle">Sign up to create your local LuckyBlox account with a real username, password, and avatar.</p>

        <?php if (!empty($errors)): ?>
            <div class="status error" aria-live="polite">
                <?php foreach ($errors as $error): ?>
                    <div><?php echo htmlspecialchars($error); ?></div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <form id="signupForm" method="POST" action="/LuckBlox.site/signup/">
            <input type="hidden" name="_csrf" value="<?php echo htmlspecialchars($csrfToken); ?>" />

            <label for="username">Username *</label>
            <input type="text" id="username" name="username" value="<?php echo $usernameVal; ?>"
                   placeholder="Choose a username" required maxlength="20"
                   pattern="[A-Za-z0-9_]{3,20}" title="3-20 characters: letters, numbers, and underscores." />
            <div class="small">3-20 characters: letters, numbers, and underscores.</div>

            <label for="displayName">Display name</label>
            <input type="text" id="displayName" name="displayName" value="<?php echo $displayNameVal; ?>"
                   placeholder="Optional: display name (defaults to username)" maxlength="35" />

            <label for="password">Password *</label>
            <input type="password" id="password" name="password" placeholder="Create a password" required minlength="8" />
            <div class="small">At least 8 characters with an uppercase letter, lowercase letter, and a number.</div>

            <label for="confirmPassword">Confirm password *</label>
            <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Confirm your password" required minlength="8" />

            <label for="gender">Gender (optional)</label>
            <select id="gender" name="gender">
                <option value="NotSpecified">Prefer not to say</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
            </select>
            <div class="small">Your avatar will use a matching default body color set.</div>

            <div class="hint">
                <strong>New to LuckyBlox?</strong> Your avatar starts with 100 Robux, classic starter items, and a free membership.
            </div>

            <div class="actions">
                <button type="submit">Create account</button>
                <button type="button" class="secondary" onclick="location.href='/LuckBlox.site/signin/'">Use sign in</button>
            </div>
        </form>

        <div class="links">
            <a href="/LuckBlox.site/home">Back to home</a>
        </div>
    </div>
    <script>
        (function() {
            var form = document.getElementById('signupForm');
            var btn = form.querySelector('button[type="submit"]');
            form.addEventListener('submit', function() {
                var u = document.getElementById('username').value.trim();
                var p = document.getElementById('password').value;
                var cp = document.getElementById('confirmPassword').value;
                var valid = true;
                var statusDiv = form.querySelector('.status.error');
                if (!statusDiv) {
                    statusDiv = document.createElement('div');
                    statusDiv.className = 'status error';
                    form.insertBefore(statusDiv, form.firstChild);
                }
                statusDiv.innerHTML = '';

                if (u.length < 3 || u.length > 20 || !/^[A-Za-z0-9_]+$/.test(u)) {
                    statusDiv.innerHTML += 'Username must be 3-20 alphanumeric/underscore characters.<br>';
                    valid = false;
                }
                if (p.length < 8) {
                    statusDiv.innerHTML += 'Password must be at least 8 characters.<br>';
                    valid = false;
                }
                if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/[0-9]/.test(p)) {
                    statusDiv.innerHTML += 'Password must include upper, lower, and a number.<br>';
                    valid = false;
                }
                if (p !== cp) {
                    statusDiv.innerHTML += 'Passwords do not match.<br>';
                    valid = false;
                }
                if (!valid) return false;

                btn.disabled = true;
                btn.textContent = 'Creating account...';
                return true;
            });
        })();
    </script>
</body>
</html>
