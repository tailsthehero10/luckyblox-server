<?php
require_once dirname(__FILE__) . '/common.php';
$key = datastore_key('key');
$path = datastore_path('items', $key);
datastore_response(datastore_read($path));
?>