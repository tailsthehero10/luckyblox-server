<?php
require_once dirname(__FILE__) . '/common.php';
$store = datastore_key('dsname');
$directory = datastore_path('ordereddatastore', $store);
if (!is_dir($directory)) {
    datastore_response('');
}

datastore_response('[' . implode(',', datastore_json_values($directory)) . ']');
?>