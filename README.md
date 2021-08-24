# Holofuel scaletest

## Running test


Please edit `tests/config.yaml` to your liking, then run

```
yarn install
yarn test
```
#### Prerequisites

Local tryorama installation at `../tryorama`:

```
cd ../tryorama
git checkout 2746b1355618f04b21feb45f0d489c3e6f5a306b
yarn install
```

Pick a version of holofuel that uses the test-only membrane proof authority (instead of the official one).

Either use a URL for your holofuel DNA or build it locally. 
