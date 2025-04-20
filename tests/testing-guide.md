# Testing Guide

This document outlines how to run the unit tests for the `gphotos-sync-node` project.

## Framework

We use [Jest](https://jestjs.io/) as our testing framework.

## Running Tests

To run all unit tests, use the following npm command from the project's root directory:

```bash
npm test
```

This command will execute Jest, which automatically discovers and runs files matching the pattern `*.test.js` within the `tests` directory.

## Test File Location

All test files should be placed within the `/tests` directory.

## Writing Tests

- Test files should be named using the pattern `[moduleName].test.js` (e.g., `configLoader.test.js`).
- Follow Jest's API for structuring tests (e.g., `describe`, `test`, `expect`).
- Mock dependencies (like `fs` or external APIs) where necessary to isolate the unit under test. 