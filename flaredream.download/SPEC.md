https://uithub.com/janwilmake/gists/tree/main/named-codeblocks.md
https://patch.forgithub.com/openapi.json

https://httpsuithubcomj-u2f9280.gptideas.com/result

Download and patch buttons (leading to gptideas.com) will be great (AT LMPIFY SITE).

- `GET /[id]/download[.zip|formdata|json]` - Download (as zipfile, multipart-formdata-stream, or file object json)

- `GET /[id]/patch => 302` - Patch to Github repo (use separate link to https://patch.forgithub.com with preset name)

https://pastebin.contextarea.com/sQfHi2k.md

Please make me a cloudflare worker that implements the download handler. It should:

- use the id to retrieve the markdown file content (use dummy implementation for now)
- use marked and the util function provided to get all codeblocks
- look at parameters.path to get the path. is required to be present for a codeblock to be used
- if no named codeblockswere found, return 400
- if no extension was provided, assume zip if accept incudes text/html, json otherwise
- if codeblock contains URL only (no further newlines or other stuff) the file content comes from the fetch response of that url
- for JSON output, format is `{ files: { [path:string]: { type:"content"|"binary", url?:string, content?:string, hash:string, size:number } }`
- for .formdata (multipart/form-data) it streams a multipart-form data stream, including all binary data from urls

<!-- Result: https://letmeprompt.com/httpspatchforgit-sphh2u0 -->
