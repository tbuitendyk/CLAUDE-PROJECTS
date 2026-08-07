<?php
// Temporary: reports how this server sees the request scheme, so the
// force-HTTPS rule in .htaccess can be written without risking a redirect
// loop. Deleted in the follow-up deploy.
header('Content-Type: text/plain');
echo 'HTTPS=' . (isset($_SERVER['HTTPS']) ? $_SERVER['HTTPS'] : '(unset)') . "\n";
echo 'X-Forwarded-Proto=' . (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) ? $_SERVER['HTTP_X_FORWARDED_PROTO'] : '(unset)') . "\n";
echo 'SERVER_PORT=' . (isset($_SERVER['SERVER_PORT']) ? $_SERVER['SERVER_PORT'] : '(unset)') . "\n";
echo 'HTTP_HOST=' . (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '(unset)') . "\n";
