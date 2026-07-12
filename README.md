### Add New Sponsor Images
 - Take image of sponsor and add to `assets/img/sponsors`

### Credit and Thanks
#### [html5up](https://html5up.net/license)
For the jump start on our HTML5
#### [Jekyll](https://jekyllrb.com/)
For site generation platform
#### [Bootstrap](https://getbootstrap.com/)
Where would any of us be without Bootstrap?

Automation of LUMA event imports

Run script locally on machine.
```
set -a; source .secrets; set +a; node scripts/fetch-luma-events.js --limit=10
```

Backfill missing historical events (dry-run first).
```
set -a; source .secrets; set +a; node scripts/fetch-luma-events.js --after=2020-01-01T00:00:00Z --include-past --limit=100
```

Tip: script defaults to future events. To include past events, provide an explicit `--after` timestamp in the past.

Persist fetched updates.
```
set -a; source .secrets; set +a; node scripts/fetch-luma-events.js --after=2020-01-01T00:00:00Z --include-past --limit=100 --write
```
