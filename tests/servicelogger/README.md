# Servicelogger scaletest

## Running test
Please edit `tests/config.yaml` to your liking, then run (from the root on the repository)
> Please note that the servicelogger DNA currently requires a bound_happ_id property to be provided.
### To run all test suites:
```
yarn test
```

### To run the Servicelogger test suite only:
```
yarn test-servicelogger
```
#### Prerequisites
- 1.  Install deps: `yarn install`

- 2. Clone a local tryorama installation at `../tryorama` and checkout to branch `2746b1355618f04b21feb45f0d489c3e6f5a306b`, which is compatible with holochain version `dc382be2a8a26d7c345e023cfaa0d8f6181697db`:
```
cd ../tryorama
git checkout 2746b1355618f04b21feb45f0d489c3e6f5a306b
yarn install
cd ../holochain-scalability-tests
yarn add ../tryorama
```

3. Use either a URL for your test DNAs or build them locally on holochain version `dc382be2a8a26d7c345e023cfaa0d8f6181697db`.
 > For the servicelogger tests, you can use the following url of a compatible version: https://holo-host.github.io/servicelogger-rsm/releases/downloads/0_0_1_alpha10/servicelogger.0_0_1_alpha10.dna
 > If running the holofuel tests as well, please consult the holofuel README for specifics on version details. See [../holofuel/README.md](/../holofuel/)

4. Update the DNAs in `config.yaml` with the path to the DNAs (url or file)
