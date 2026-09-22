<?php
error_reporting(~E_ALL);
require("functions.php");
header("content-type:text/plain");
$placeid = $_GET["placeid"];
$ip = $_GET['ip'];
$port = $_GET['port'];
$id = $_GET['id'];
$user = $_GET['user'];
$app = $_GET['app'];
$membership = $_GET["membership"];
$file = file_get_contents("./joinguest.txt");
$file = str_replace("%user%", $user, $file);
$file = str_replace("%ip%", $ip, $file);
$file = str_replace("%port%", $port, $file);
$file = str_replace("%id%", $id, $file);
$file = str_replace("%app%", $app, $file);
$file = str_replace("%membership%", $membership, $file);
echo($file);
?>