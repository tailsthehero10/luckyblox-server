<?php
/**
 * LuckyBlox asset cache.
 *
 * Downloads a Roblox asset once, writes the real bytes to Webserver/www/SavedAssets/,
 * and serves those bytes from disk on every later request. This replaces the
 * inline copy of this logic that was duplicated across asset/, v1/asset/,
 * ur/asset/, aset/asset/, assetfixtt/asset/ and www.civdefn.tk/asset/.
 *
 * The old code had three defects that left 8,000+ empty cache files behind:
 *
 *   1. It called fopen($file_name, "w") BEFORE the download, which creates a
 *      0-byte file. Any failed download left that empty file cached forever.
 *   2. A 0-byte file was re-fetched but never deleted, so dead entries accumulated.
 *   3. It passed a URL *string* to file_get_contents() to test for an empty
 *      response, which re-downloaded the asset a second time on every miss, and
 *      called filesize() on the URL itself rather than the cached file.
 *
 * Here the bytes are downloaded first, written to a temp file, and only renamed
 * into place once they are non-empty - so a partial or failed download can never
 * be cached as a valid entry.
 */

/**
 * Absolute path of the SavedAssets cache directory.
 */
function lb_asset_cache_dir()
{
    $dir = realpath(dirname(__FILE__) . '/../../');
    if ($dir === false) {
        $dir = dirname(__FILE__) . '/../..';
    }
    return $dir . '/SavedAssets';
}

/** Create the cache directory on first use. */
function lb_asset_cache_ensure_dir()
{
    $dir = lb_asset_cache_dir();
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    return $dir;
}

/**
 * A filesystem-safe cache file name for a request id.
 *
 * Request ids are usually a bare asset id ("1818") but can carry a legacy
 * "1111111<id>" audio prefix, so anything outside a conservative character set
 * is percent-encoded rather than used raw - an id must never be able to escape
 * the cache directory.
 */
function lb_asset_cache_file($id)
{
    $safe = preg_replace('/[^A-Za-z0-9_\-]/', '_', (string) $id);
    return lb_asset_cache_dir() . '/' . $safe;
}

/**
 * Serve a cached asset if a non-empty copy exists on disk.
 *
 * Returns true when the response was sent, false on a cache miss. A 0-byte file
 * is treated as a miss AND removed, so leftovers from the old code clean
 * themselves up as they are encountered.
 */
function lb_asset_cache_serve($id)
{
    $file = lb_asset_cache_file($id);
    if (!file_exists($file)) {
        return false;
    }

    clearstatcache(true, $file);
    $size = @filesize($file);

    if ($size === false || $size <= 0) {
        @unlink($file);
        return false;
    }

    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . $size);
    header('Cache-Control: public, max-age=86400');
    readfile($file);
    return true;
}

/**
 * Download $url and store it in the cache under $id.
 *
 * Returns the cached path on success, or null on failure. The download is staged
 * through a temp file and renamed only when it has real content, so the cache
 * never holds a partial file.
 */
function lb_asset_cache_store($id, $url, $decompress = true)
{
    lb_asset_cache_ensure_dir();

    $context = stream_context_create(array(
        'http' => array(
            'timeout' => 20,
            'follow_location' => 1,
            'user_agent' => 'LuckyBlox/1.0',
        ),
    ));

    $body = @file_get_contents($url, false, $context);
    if ($body === false || $body === '') {
        return null;
    }

    // Roblox assetdelivery returns gzip-compressed payloads; expand them so the
    // cached file is the usable asset. If it is not actually gzip, keep it as-is.
    if ($decompress) {
        $inflated = @gzdecode($body);
        if ($inflated === false) {
            $inflated = @gzinflate($body);
        }
        if ($inflated !== false && $inflated !== '') {
            $body = $inflated;
        }
    }

    if ($body === '') {
        return null;
    }

    $file = lb_asset_cache_file($id);
    $tmp = $file . '.tmp-' . getmypid();

    if (@file_put_contents($tmp, $body) === false) {
        @unlink($tmp);
        return null;
    }

    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        return null;
    }

    return $file;
}

/**
 * Resolve, cache and send an asset for a request id.
 *
 * Handles the three id shapes the legacy endpoints received:
 *   - a full http(s) URL          -> redirect straight to it
 *   - "1111111<assetId>"          -> the legacy audio form, fetched at version 1
 *   - a bare asset id             -> the standard asset delivery URL
 *
 * Returns true when bytes were served or a redirect was issued.
 */
function lb_asset_cache_respond($id)
{
    $id = (string) $id;

    // Already cached and non-empty - serve from disk.
    if (lb_asset_cache_serve($id)) {
        return true;
    }

    // An absolute URL is simply proxied.
    if (strpos($id, 'http') === 0) {
        header('Location: ' . $id);
        return true;
    }

    // The legacy "1111111<id>" audio form.
    if (strpos($id, '1111111') !== false) {
        $parts = explode('1111111', $id);
        $assetId = isset($parts[1]) ? $parts[1] : '';
        if ($assetId !== '') {
            $stored = lb_asset_cache_store(
                $id,
                'https://assetdelivery.roblox.com/v1/asset/?id=' . $assetId . '&version=1'
            );
            if ($stored !== null && lb_asset_cache_serve($id)) {
                return true;
            }
        }
        return false;
    }

    // A bare asset id.
    $stored = lb_asset_cache_store($id, 'https://assetdelivery.roblox.com/v1/asset/?id=' . $id);
    if ($stored !== null && lb_asset_cache_serve($id)) {
        return true;
    }

    return false;
}