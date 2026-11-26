# Security policy

Arc40 is a **local-only** personal finance app. It runs on your own computer, binds only to `127.0.0.1`, makes no
outbound network calls and stores everything in one local SQLite file. There is no hosted service, no account system
and no server run by anyone else. The README's "Security design" section describes how it is protected.

## Scope

In scope: the Arc40 app as published in this repository, running on `127.0.0.1` (the server, its API, the web pages it
serves, CSV import and parsing, backups, export and restore, demo mode isolation, and the scripts in `scripts/`).

Examples of useful reports:

- a way for a web page you visit to read or change Arc40 data (CSRF, DNS rebinding, CORS, clickjacking),
- a way around the password, session or auto-lock,
- a CSV or price file that crashes the server, runs code, or writes outside the data folder,
- an export, backup or log that leaks data it should not,
- demo mode reading or writing the real database.

Out of scope: someone who already controls your user account or your computer (they can read the database file
directly; full-disk encryption such as FileVault is the protection there), denial of service against your own local
server, and issues in third-party packages that do not affect Arc40 (please report those upstream).

## Reporting a problem

Please report security problems privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability** (GitHub private vulnerability reporting). Do not open a public issue for a security problem.

Include what you found, the steps to reproduce it and the version or commit you tested. Please use fake data only;
never send real financial files.

This is a personal project maintained by one person, so there is no bug bounty and no fixed response time, but every
report will be read and answered.
