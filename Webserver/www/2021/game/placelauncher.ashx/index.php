<?php
error_reporting(~E_ALL);
header("content-type:text/plain");
require_once __DIR__ . '/../../../api/common.php';
$user = $_GET['user'];
$membership = $_GET["membership"];
$ip = $_GET['ip'];
$port = $_GET['port'];
$id = $_GET['id'];
$app = $_GET['app'];
$age = isset($_GET['age']) ? $_GET['age'] : "1859";
// Public base URL from env so the join script points at the live deployment.
$baseUrl = api_public_base_url();
?>
{"jobId":"Test","status":2,"joinScriptUrl":"<?php echo $baseUrl ?>2021/game/join.ashx?placeid=1818&ip=<?php echo urlencode($ip); ?>&port=<?php echo urlencode($port); ?>&user=<?php echo urlencode($user); ?>&id=<?php echo urlencode($id); ?>&membership=<?php echo urlencode($membership); ?>&app=<?php echo urlencode($app); ?>&age=<?php echo urlencode($age); ?>","authenticationUrl":"<?php echo $baseUrl ?>2021/Login/Negotiate.ashx","authenticationTicket":"1","message":null}
