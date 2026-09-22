<?php
require_once dirname(__FILE__) . '/functions.php';
header("content-type:text/plain");
$port = request_port();
$f1 = str_replace("%port%",$port,file_get_contents(dirname(__FILE__) . "/2014host.txt"));
echo(sign($f1));
?>
