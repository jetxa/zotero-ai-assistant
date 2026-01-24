## Frequently Asked Questions

### 1. Error message: "Parent Item xxxxxxxx must be a regular item" when sending a message

**Error Screenshot**

<img src="image/qa/single_file_error.png" alt="error" width="400">

**Solution**

1. Check if the current literature is a standalone file rather than a Zotero Item, as shown below:

<img src="image/qa/single_file.png" alt="error" width="700">

- "DeepFM: A Factorization-Machine based Neural Network for C..." - This item has a `>` symbol in front, indicating it is a Zotero Item
- "Factorization Machines" - This item does not have a `>` symbol, indicating it is a standalone file


2. Convert the standalone file to a Zotero Item: Select the file, right-click, and choose `Create Parent Item`

<img src="image/qa/single_file_create_parent.png" alt="error" width="400">

3. After conversion, the literature becomes a Zotero Item, with a `>` symbol in front indicating it is now a Zotero Item

<img src="image/qa/single_file_error_fix.png" alt="error" width="600">
