# Gym compatibility

`check.py` is a copy of gym's `scripts/check.py`. The `gym-compat` test (`npm run test:gym`) writes a repository with the app's sync code, as the app would on GitHub, and runs this checker on it (G9). Refresh the copy when gym's checker changes:

```sh
cp ../gym/scripts/check.py tests/gym/check.py
```
