<?php
require_once dirname(__FILE__) . '/functions.php';
header("content-type:text/plain");
$port = request_port();
$user = request_text('username', '/^[A-Za-z0-9 _.-]+$/', 'Invalid username');
$ip = request_text('ip', '/^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])$/', 'Invalid server address');
$id = request_text('id', '/^[0-9]+$/', 'Invalid user id');
$app = request_text('app', '/^[A-Za-z0-9_.-]+$/', 'Invalid app');
$mode = request_text('mode', '/^[A-Za-z0-9_.-]+$/', 'Invalid mode');
$f1 = str_replace("%user%",$user,file_get_contents(dirname(__FILE__) . "/2014join.txt"));
$f2 = str_replace("%ip%",$ip,$f1);
$f3 = str_replace("%port%",$port,$f2);
$f4 = str_replace("%id%",$id,$f3);
$f5 = str_replace("%app%",$app,$f4);
$f6 = str_replace("%mode%",$mode,$f5);
echo(sign($f6));
?>
