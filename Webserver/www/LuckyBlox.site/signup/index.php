<?php
$rootPath = realpath(__DIR__ . '/../../../');
$settingsRoot = $rootPath . '/Settings';

function read_setting($path, $default = '') {
    if (!file_exists($path)) {
        return $default;
    }

    $value = trim((string) file_get_contents($path));
    return $value !== '' ? $value : $default;
}

$username = read_setting($settingsRoot . '/username.txt', 'default');
$membership = read_setting($settingsRoot . '/membership.txt', 'None');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>LuckyBlox Sign Up</title>
    <style>
        body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #020617, #0f172a); color: #e2e8f0; margin: 0; padding: 40px; }
        .container { max-width: 900px; margin: 0 auto; }
        .card { background: rgba(15, 23, 42, 0.95); border: 1px solid #334155; border-radius: 14px; padding: 24px; box-shadow: 0 15px 30px rgba(0,0,0,0.25); }
        h1, h2 { margin-top: 0; }
        form { display: grid; gap: 16px; }
        label { display: grid; gap: 8px; color: #cbd5e1; }
        input, select, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; }
        button { background: #2563eb; border: none; cursor: pointer; font-weight: 700; }
        button.secondary { background: #0f766e; }
        .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
        .status { margin-top: 12px; min-height: 20px; color: #86efac; }
        .status.error { color: #fca5a5; }
        a { color: #7dd3fc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>Create account</h1>
            <p>Sign up locally in this bundled launcher project. The account is stored in the Settings folder used by the current backend APIs.</p>

            <form id="signupForm">
                <label>
                    Username
                    <input type="text" name="username" value="<?php echo htmlspecialchars($username); ?>" placeholder="Choose a username" required />
                </label>

                <label>
                    Membership
                    <select name="membership">
                        <option value="None" <?php echo $membership === 'None' ? 'selected' : ''; ?>>None</option>
                        <option value="Classic" <?php echo $membership === 'Classic' ? 'selected' : ''; ?>>Classic</option>
                        <option value="BuildersClub" <?php echo $membership === 'BuildersClub' ? 'selected' : ''; ?>>BuildersClub</option>
                        <option value="TurboBuildersClub" <?php echo $membership === 'TurboBuildersClub' ? 'selected' : ''; ?>>TurboBuildersClub</option>
                        <option value="OutrageousBuildersClub" <?php echo $membership === 'OutrageousBuildersClub' ? 'selected' : ''; ?>>OutrageousBuildersClub</option>
                    </select>
                </label>

                <div class="actions">
                    <button type="submit">Create local account</button>
                    <button type="button" class="secondary" onclick="location.href='/LuckBlox.site.tk/signin'">Use sign in</button>
                </div>
            </form>

            <div id="status" class="status" aria-live="polite"></div>
        </div>

        <p style="margin-top: 20px;"><a href="/LuckBlox.site.tk/">Back to dashboard</a></p>
    </div>

    <script>
        const signupForm = document.getElementById('signupForm');
        const statusEl = document.getElementById('status');

        signupForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(signupForm).entries());

            statusEl.textContent = 'Creating account...';
            statusEl.classList.remove('error');

            try {
                const response = await fetch('/api/account.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });

                const result = await response.json();

                if (result.ok) {
                    statusEl.textContent = 'Local account created successfully. Redirecting...';
                    setTimeout(() => window.location.href = '/LuckBlox.site.tk/account', 500);
                    return;
                }

                throw new Error(result.error || 'Unable to create account.');
            } catch (error) {
                statusEl.textContent = error.message || 'Unable to create account.';
                statusEl.classList.add('error');
            }
        });
    </script>
    <script src="/legacy-nav.js"></script>
</body>
</html>
