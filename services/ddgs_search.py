"""Read one query from stdin and write one UTF-8 JSON response to stdout."""
import json
import sys


def run():
    try:
        from ddgs import DDGS
    except ImportError:
        return {"error": "当前 Python 未安装 ddgs，请运行 python -m pip install -r services/requirements.txt。"}

    try:
        query = json.load(sys.stdin)["query"]
        results = list(DDGS(timeout=7).text(query, max_results=7))
        return {"results": results}
    except Exception:
        return {"error": "ddgs 暂时无法取得搜索结果，请检查网络或试用 SearXNG。"}


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False))
