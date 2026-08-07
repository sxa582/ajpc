import importlib.util
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "import_pmc.py"
SPEC = importlib.util.spec_from_file_location("import_pmc", MODULE_PATH)
import_pmc = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(import_pmc)


class ExtractLicenseTests(unittest.TestCase):
    def article(self, license_text: str) -> ET.Element:
        node = ET.Element("article")
        permissions = ET.SubElement(node, "permissions")
        license_node = ET.SubElement(permissions, "license")
        paragraph = ET.SubElement(license_node, "license-p")
        paragraph.text = license_text
        return node

    def test_accepts_plain_text_cc_by_url(self):
        license_data = import_pmc.extract_license(
            self.article(
                "This is an open access article under the CC BY license "
                "https://creativecommons.org/licenses/by/4.0/"
            )
        )
        self.assertEqual(license_data["name"], "CC BY 4.0")

    def test_rejects_cc_by_nc_url(self):
        with self.assertRaises(PermissionError):
            import_pmc.extract_license(
                self.article("https://creativecommons.org/licenses/by-nc/4.0/")
            )

    def test_rejects_cc_by_nc_nd_url(self):
        with self.assertRaises(PermissionError):
            import_pmc.extract_license(
                self.article("https://creativecommons.org/licenses/by-nc-nd/4.0/")
            )


if __name__ == "__main__":
    unittest.main()
