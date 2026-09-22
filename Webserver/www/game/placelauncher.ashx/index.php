<?php
error_reporting(~E_ALL);
header("content-type:text/plain");
require_once __DIR__ . '/../../api/common.php';
$user = $_GET['user'];
$membership = $_GET["membership"];
$ip = $_GET['ip'];
$port = $_GET['port'];
$user = $_GET['user'];
$id = $_GET['id'];
$app = $_GET['app'];
// Public base URL from env so the join script points at the live deployment.
$baseUrl = api_public_base_url();
?>
{"jobId":"Test","status":2,"joinScriptUrl":"<?php echo $baseUrl ?>game/Join.ashx?placeid=1818&ip=<?php echo $ip ?>&port=<?php echo $port ?>&user=<?php echo $user ?>&id=<?php echo $id ?>&membership=<?php echo $membership ?>&app=<?php echo $app ?>","authenticationUrl":"<?php echo $baseUrl ?>Login/Negotiate.ashx","authenticationTicket":"1","message":null}
