<?php
require_once __DIR__ . '/luckyblox-data.php';

session_start();

lb_destroy_session();
header('Location: /LuckBlox.site/signin/');
exit;
