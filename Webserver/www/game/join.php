<?php
error_reporting(~E_ALL);
require("functions.php");
require_once __DIR__ . '/../api/common.php';
header("content-type:text/plain");
$placeid = $_GET["placeid"];
$ip = isset($_GET['ip']) && trim((string) $_GET['ip']) !== '' ? $_GET['ip'] : api_public_server_ip();
$port = isset($_GET['port']) && trim((string) $_GET['port']) !== '' ? $_GET['port'] : api_public_game_port();
$id = $_GET['id'];
$user = $_GET['user'];
$app = $_GET['app'];
$f1 = str_replace("%user%",$user,file_get_contents("./joinguest.txt"));
$f2 = str_replace("%ip%",$ip,$f1);
$f3 = str_replace("%port%",$port,$f2);
$f4 = str_replace("%id%",$id,$f3);
$f5 = str_replace("%app%",$app,$f4);
echo(sign($f5));
?>
