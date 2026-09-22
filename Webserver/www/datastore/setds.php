<?php
require_once dirname(__FILE__) . '/common.php';
$key = datastore_key('key');
$value = datastore_value();
$path = datastore_path('items', $key);
datastore_write($path, $value);
datastore_response(datastore_read($path));
?>