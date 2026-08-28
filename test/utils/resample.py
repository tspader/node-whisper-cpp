import sys

import numpy as np

inp_path, out_path, from_rate, to_rate = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
data = np.fromfile(inp_path, dtype=np.float32).astype(np.float64)
ratio = from_rate / to_rate
length = int(np.floor(data.shape[0] / ratio))
x = np.arange(length) * ratio
out = np.interp(x, np.arange(data.shape[0]), data).astype(np.float32)
out.tofile(out_path)
