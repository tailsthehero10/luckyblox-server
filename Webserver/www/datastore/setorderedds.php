<?php
require_once dirname(__FILE__) . '/common.php';
$store = datastore_key('dsname');
$key = datastore_key('key');
$value = datastore_value();
$directory = datastore_path('ordereddatastore', $store);
if (!is_dir($directory) && !mkdir($directory, 0775, true)) {
    datastore_error(503, 'Ordered datastore is unavailable');
}
datastore_write($directory . DIRECTORY_SEPARATOR . $key, $value);
datastore_response('[' . implode(',', datastore_json_values($directory)) . ']');
?>