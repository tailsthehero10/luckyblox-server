<?php
require_once dirname(__FILE__) . '/../game/functions.php';
$this_dir = dirname(__FILE__);
$parent_dir = realpath($this_dir . '/../../');
$target_path = $parent_dir . '/SavedAssets/';

error_reporting(0);
function asset_id() {
    $value = isset($_GET['id']) ? trim((string) $_GET['id']) : '';
    if ($value === '' || strlen($value) > 64 || !preg_match('/^(?:[0-9]+|1111111[0-9]+)$/', $value)) {
        header('HTTP/1.1 400 Bad Request');
        die('Invalid asset id');
    }
    return $value;
}

if (!is_dir($target_path) && !mkdir($target_path, 0775, true)) {
    header('HTTP/1.1 503 Service Unavailable');
    die('Asset cache is unavailable');
}

$asset_id = asset_id();
$cached_path = $target_path . $asset_id;

function gzfilesize($zp) {
      $gzfs = strlen($zp);
  return($gzfs);
}

$stringxd = $asset_id;
function uncompress($srcName, $dstName) {
    $sfp = gzopen($srcName, "rb");
    $fp = fopen($dstName, "w");

    while ($string = gzread($sfp, 4096)) {
        fwrite($fp, $string, strlen($string));
    }
    gzclose($sfp);
    fclose($fp);
}

$local_path = dirname(__FILE__) . '/' . $asset_id;
if(file_exists($local_path))
{
    header("Content-type: text/plain");
    die(sign(file_get_contents($local_path)));
}
else
{
if(file_exists($cached_path) && file_get_contents($cached_path)!="")
{
 header("Content-type: text/plain");
	$finished = file_get_contents($cached_path);
    echo $finished;
}
else
{
if (strstr($stringxd,'1111111'))
{
$parts = explode("1111111", $stringxd);
$s2 = $parts[1];
$urlxd = "https://assetdelivery.roblox.com/v1/asset/?id=".$s2."&version=1";
$file_name = $cached_path;
$myfile = fopen($file_name, "w");
header($_SERVER["SERVER_PROTOCOL"] . " 200 OK");
    header("Cache-Control: public");
    header("Content-Type: application/zip");
    header("Content-Transfer-Encoding: Binary");
    header("Content-Length:".filesize($url));
    header("Content-Disposition: attachment; filename=filePath");
if (file_get_contents($urlxd)=="") {
$fp = fopen($file_name, "w");
$url = "https://api.hyra.io/audio/".$stringxd;
$finished = file_get_contents($urlxd);
fwrite($fp, $finished);
fclose($fp);
}
else
{
uncompress($urlxd,$file_name);
}
Header("Location: ".$urlxd);
}
else
{
$stringxd = $asset_id;
$url = "https://assetdelivery.roblox.com/v1/asset/?id=".$stringxd;
$file_name = $cached_path;
$myfile = fopen($file_name, "w");
header($_SERVER["SERVER_PROTOCOL"] . " 200 OK");
    header("Cache-Control: public");
    header("Content-Type: application/zip");
    header("Content-Transfer-Encoding: Binary");
    header("Content-Length:".filesize($url));
    header("Content-Disposition: attachment; filename=filePath");
if (file_get_contents($url)=="") {
$fp = fopen($file_name, "w");
$url = "https://api.hyra.io/audio/".$stringxd;
$finished = file_get_contents($url);
fwrite($fp, $finished);
fclose($fp);
}
else
{
uncompress($url,$file_name);
}
Header("Location: ".$url);
}
}
}
?>