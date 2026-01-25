## 常见问题

### 1. 发送消息提示 Parent Item xxxxxxxx must be a regular item

**问题示意图**

<img src="image/qa/single_file_error.png" alt="error" width="400">

**解决方法**

1. 检查当前文献是否为单个文件，而不是zotero Item
   如下图

<img src="image/qa/single_file.png" alt="error" width="700">

- DeepFM: A Factorization-Machine based Neural Network for C..., 这篇文献前面有一个 `>` 符号，表示是zotero Item
- Factorization Machines, 这篇文献前面没有 `>` 符号，表示是单个文件

2. 将单个文件转换为zotero Item：选中文件，右键点击，选择 `Create Parent Item`

<img src="image/qa/single_file_create_parent.png" alt="error" width="400">

3. 转换后，文献变为zotero Item，前面有一个 `>` 符号，表示是zotero Item

<img src="image/qa/single_file_error_fix.png" alt="error" width="600">


### 2. 选中"Full Text" 时没有生效

检查一下当前的文献是否被索引，如果没有索引，Full Text获取不到全文内容，需要手动索引（目前已经在代码中执行了索引操作，如果索引失败，需要手动触发索引）

**未索引示意图**，选择PDF附件，若indexed为No，表示未索引，可以手动点击圆圈触发索引

<img src="image/qa/item_not_indexed.png" alt="error" width="600">
