# Parser/serializer fixtures

Fixtures use the same versioned JSON envelope in desktop and WebUI tests:

```json
{
  "fixtureSchemaVersion": 1,
  "type": "runtime-metadata|diagnostics|configuration|streaming-state",
  "name": "descriptive-fixture-name",
  "value": {}
}
```

Keep fixture values plain JSON and representative: no secrets, message content, private paths, `Date` instances, or process handles. Domain tests parse `value`, serialize the parsed value, and use `assertParsePrintParse` from `parse-print-parse.ts` to verify stable parse-print-parse behavior. Use `assertInvalidFixture` for descriptive parser failures.
