# Making it streaming

What can be improved: make download streaming!

- improve 'content-type' and 'isBinary' calculations to be more complete
- create test with many large files
- see if it can be made faster by somehow paralellizing and buffering downloads without getting over memory limit

I can easily make it streaming, but it's not a good improvement if that reduces concurrency to 1 url at a time. If we want to get to streaming it should allow parallel url fetching and buffering with a cap (Maybe a Semaphore, read:https://codexbook.medium.com/implement-the-producer-consumer-problem-with-semaphores-and-mutex-locks-a91560c5dc0e) such that we still benefit from downloading as many URLs as we can within a cloudflare worker.

That said, streaming bigger files is not a direct requirement for cloudflare worker/assets deployment, because assets deployment is also restricted to the max memory. To make asset upload work for large assets sizes from a SINGLE formdata stream, we need temporary storage in R2.

- first pass: calculate manifest and stream incoming formdata stream to temporary R2 bucket
- upload manifest and retrieve buckets
- second pass: in parallel, upload every bucket from the temporary R2 bucket
- remove temporary bucket

This is all only needed to resolve the limitation of max ±50MB of download/upload. Lot of work and not part of initial scope!

# Splitting up manifest calculation and upload, and individual bucket uploads

Ultimately I want to optimise for speed for uploading to get a asset jwt not from a submit FormData per se, but from either an R2 bucket OR SQLite DB. These are different problems because R2/DO can potentially already have a manifest ready, pre-calculated and retrievable in a single query.

It's important to be aware of this because this can make upload much faster, as it takes a while now to retrieve the manifest!

A cool exploration would be to calculate hash and store this in the `nodes` table in `xytext` so a manifest is retrieved in a single query. Also, maybe, binary files can be backed by R2 rather than the DO itself, to overcome severe limitations (but the hash should still be in the table).
