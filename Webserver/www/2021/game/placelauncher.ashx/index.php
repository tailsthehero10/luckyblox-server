<?php
error_reporting(~E_ALL);
header("content-type:text/plain");
$user = $_GET['user'];
$membership = $_GET["membership"];
$ip = $_GET['ip'];
$port = $_GET['port'];
$id = $_GET['id'];
$app = $_GET['app'];
$age = isset($_GET['age']) ? $_GET['age'] : "1859"; 
?>
{"jobId":"Test","status":2,"joinScriptUrl":"http://localhost/2021/game/join.ashx?placeid=1818&ip=<?php echo urlencode($ip); ?>&port=<?php echo urlencode($port); ?>&user=<?php echo urlencode($user); ?>&id=<?php echo urlencode($id); ?>&membership=<?php echo urlencode($membership); ?>&app=<?php echo urlencode($app); ?>&age=<?php echo urlencode($age); ?>","authenticationUrl":"http://localhost/2021/Login/Negotiate.ashx","authenticationTicket":"1","message":null}
