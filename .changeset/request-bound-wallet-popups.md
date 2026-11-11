---
"@fastxyz/sdk": major
---

When a popup sends an origin challenge, require a version 2 proof bound to the exact connect request or signing transaction. Popups that return a result without challenging still work. Open a separate popup for each operation. Older unversioned challenges fail closed; coordinate adoption with Fast App's version 2 connect popup.
