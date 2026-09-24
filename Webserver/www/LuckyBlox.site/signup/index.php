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

        // Birthday is three separate dropdowns (Month / Day / Year), matching the
        // Roblox 2021 create-account form. Assemble them into YYYY-MM-DD.
        $birthMonth = isset($_POST['birthMonth']) ? (int) $_POST['birthMonth'] : 0;
        $birthDay = isset($_POST['birthDay']) ? (int) $_POST['birthDay'] : 0;
        $birthYear = isset($_POST['birthYear']) ? (int) $_POST['birthYear'] : 0;
        $birthday = null;
        if ($birthMonth >= 1 && $birthMonth <= 12 && $birthDay >= 1 && $birthDay <= 31 && $birthYear >= 1900 && $birthYear <= (int) date('Y')) {
            $birthday = sprintf('%04d-%02d-%02d', $birthYear, $birthMonth, $birthDay);
        }

        $result = lb_signup($username, $password, $confirmPassword, $displayName, $gender, $birthday);
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

$birthMonthVal = isset($_POST['birthMonth']) ? (int) $_POST['birthMonth'] : 0;
$birthDayVal = isset($_POST['birthDay']) ? (int) $_POST['birthDay'] : 0;
$birthYearVal = isset($_POST['birthYear']) ? (int) $_POST['birthYear'] : 0;
$genderVal = $_POST['gender'] ?? 'NotSpecified';

$monthNames = array(
    1 => 'January', 2 => 'February', 3 => 'March', 4 => 'April',
    5 => 'May', 6 => 'June', 7 => 'July', 8 => 'August',
    9 => 'September', 10 => 'October', 11 => 'November', 12 => 'December',
);
$currentYear = (int) date('Y');
$genderLabels = array('NotSpecified' => 'Not specified', 'Male' => 'Male', 'Female' => 'Female');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LuckyBlox Sign Up</title>
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <link rel="stylesheet" href="/css/lb-select.css" />
    <style>
        body {
            margin: 0; padding: 0;
            font-family: "Gotham SSm", Arimo, "Segoe UI", Arial, sans-serif;
            background: url('/site-icon/BackgroundSigninup/sign page.jpg') no-repeat center center fixed;
            background-size: cover; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .card {
            background: #ffffff; border-radius: 8px;
            box-shadow: 0 4px 24px rgba(25, 39, 68, 0.25); width: 100%; max-width: 420px;
            padding: 32px 40px 28px; box-sizing: border-box;
        }
        .brand { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 20px; }
        .brand img { width: 40px; height: 40px; }
        .brand span { font-weight: 800; font-size: 1.6rem; color: #232527; letter-spacing: -0.02em; }
        h1 { margin: 0 0 4px; color: #393b3d; font-size: 1.6rem; font-weight: 800; text-align: center; }
        p.subtitle { margin: 0 0 22px; color: #6b6e72; font-size: 0.9rem; text-align: center; line-height: 1.5; }
        form { display: grid; gap: 16px; }
        label { display: block; color: #393b3d; font-size: 0.85rem; font-weight: 700; margin-bottom: 6px; }
        input, select {
            font: inherit; padding: 10px 12px; border-radius: 4px;
            border: 1px solid #b8bcc1; background: #ffffff; color: #232527;
            width: 100%; box-sizing: border-box; height: 40px;
        }
        select { appearance: none; -webkit-appearance: none; background-image: url('/icons/dropdown.svg'); background-repeat: no-repeat; background-position: right 10px center; background-size: 12px; padding-right: 30px; }
        select:focus, input:focus { outline: none; border-color: #00a2ff; box-shadow: 0 0 0 1px #00a2ff; }
        .birthday-row { display: grid; grid-template-columns: 1.4fr 1fr 1.1fr; gap: 8px; }
        .birthday-row select { padding-left: 8px; }
        button { padding: 11px; border-radius: 4px; border: none; background: #00a2ff; color: #fff; font-weight: 800; cursor: pointer; font-size: 0.95rem; transition: background .15s; }
        button:hover { background: #0086d6; }
        .button.secondary { background: #e3e7eb; color: #393b3d; }
        .button.secondary:hover { background: #d3d9df; }
        .actions { display: flex; gap: 12px; margin-top: 4px; }
        .actions button { flex: 1; }
        .status { margin-top: 0; margin-bottom: 14px; font-size: 0.9rem; }
        .status.error { color: #d9534f; }
        .hint { margin: 0; padding: 10px 12px; border-radius: 4px; background: #eef5ff; border: 1px solid #c9ddff; color: #3b5a8a; font-size: 0.82rem; line-height: 1.5; }
        a { color: #00a2ff; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .links { margin-top: 18px; text-align: center; font-size: 0.9rem; color: #6b6e72; }
        .small { font-size: 0.78rem; color: #8b8e92; font-weight: 400; }
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

            <label>Birthday *</label>
            <div class="birthday-row">
                <select class="lb-select" id="birthMonth" name="birthMonth" aria-label="Birth month" required>
                    <option value="">Month</option>
                    <?php foreach ($monthNames as $num => $name): ?>
                        <option value="<?php echo $num; ?>"<?php echo $birthMonthVal === $num ? ' selected' : ''; ?>><?php echo htmlspecialchars($name); ?></option>
                    <?php endforeach; ?>
                </select>
                <select class="lb-select" id="birthDay" name="birthDay" aria-label="Birth day" required>
                    <option value="">Day</option>
                    <?php for ($d = 1; $d <= 31; $d++): ?>
                        <option value="<?php echo $d; ?>"<?php echo $birthDayVal === $d ? ' selected' : ''; ?>><?php echo $d; ?></option>
                    <?php endfor; ?>
                </select>
                <select class="lb-select" id="birthYear" name="birthYear" aria-label="Birth year" required>
                    <option value="">Year</option>
                    <?php for ($y = $currentYear; $y >= 1900; $y--): ?>
                        <option value="<?php echo $y; ?>"<?php echo $birthYearVal === $y ? ' selected' : ''; ?>><?php echo $y; ?></option>
                    <?php endfor; ?>
                </select>
            </div>

            <label for="username">Username *</label>
            <input type="text" id="username" name="username" value="<?php echo $usernameVal; ?>"
                   placeholder="Choose a username" required maxlength="20" autocomplete="username"
                   pattern="[A-Za-z0-9_]{3,20}" title="3-20 characters: letters, numbers, and underscores." />
            <div class="small">3-20 characters: letters, numbers, and underscores.</div>

            <label for="displayName">Display name (optional)</label>
            <input type="text" id="displayName" name="displayName" value="<?php echo $displayNameVal; ?>"
                   placeholder="Defaults to your username" maxlength="35" />

            <label for="password">Password *</label>
            <input type="password" id="password" name="password" placeholder="Create a password" required minlength="8" autocomplete="new-password" />
            <div class="small">At least 8 characters with an uppercase letter, lowercase letter, and a number.</div>

            <label for="confirmPassword">Confirm password *</label>
            <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Confirm your password" required minlength="8" autocomplete="new-password" />

            <label for="gender">Gender (optional)</label>
            <select class="lb-select" id="gender" name="gender">
                <?php foreach ($genderLabels as $value => $label): ?>
                    <option value="<?php echo htmlspecialchars($value); ?>"<?php echo $genderVal === $value ? ' selected' : ''; ?>><?php echo htmlspecialchars($label); ?></option>
                <?php endforeach; ?>
            </select>
            <div class="small">Your avatar will use a matching default body color set.</div>

            <div class="hint">
                <strong>New to LuckyBlox?</strong> Your avatar starts with 100 Robux, classic starter items, and a free membership.
            </div>

            <div class="actions">
                <button type="submit">Sign Up</button>
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
                var bm = document.getElementById('birthMonth').value;
                var bd = document.getElementById('birthDay').value;
                var by = document.getElementById('birthYear').value;
                var valid = true;
                var statusDiv = form.querySelector('.status.error');
                if (!statusDiv) {
                    statusDiv = document.createElement('div');
                    statusDiv.className = 'status error';
                    form.insertBefore(statusDiv, form.firstChild);
                }
                statusDiv.innerHTML = '';

                if (!bm || !bd || !by) {
                    statusDiv.innerHTML += 'Please enter your birthday.<br>';
                    valid = false;
                }
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
    <script src="/lb-select.js"></script>
</body>
</html>
