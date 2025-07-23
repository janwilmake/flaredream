Unfortunately Safari seems to have a bug where webkitdirectory doesn't send along the relative path, just the filenames, with the form submission with method post

I opened this issue: https://bugs.webkit.org/show_bug.cgi?id=296380

When using `credentials:true` we can use the credentials that were available on the server, but this also complicates things since we need more strict allow-origin headers: `Cannot use wildcard in Access-Control-Allow-Origin when credentials flag is true`. This sucks so maybe it's better to first login here ourselves.
