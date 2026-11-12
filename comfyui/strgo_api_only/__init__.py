"""ComfyUI extension for a remote text API and free media contract demonstrations."""
from . import config
from .providers import Mock, OpenAICompatible

WEB_DIRECTORY = './web'


class Text:
    CATEGORY = 'STRGO/API-only'
    FUNCTION = 'execute'
    RETURN_TYPES = ('STRING',)

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'selection': (config.load().selections(),),
                             'prompt': ('STRING', {'multiline': True})}}

    async def execute(self, selection, prompt):
        provider, alias = selection.split(':', 1)
        if provider == 'mock':
            mock = Mock()
            return (await mock.result(await mock.submit(prompt, 'text')),)
        import strgo_engine_guard
        model = config.load().model(provider, alias)
        if not model.enabled:
            raise ValueError('This provider is disabled.')
        job = await strgo_engine_guard.claim_current_job()
        result, vendor_id = await OpenAICompatible(model).submit(prompt)
        await strgo_engine_guard.record_receipt(job, vendor_id)
        return (result,)


class MockImage:
    CATEGORY = 'STRGO/API-only'
    FUNCTION = 'execute'
    RETURN_TYPES = ('STRING',)
    kind = 'image'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'prompt': ('STRING', {'multiline': True})}}

    async def execute(self, prompt):
        mock = Mock()
        return (await mock.result(await mock.submit(prompt, self.kind)),)


class MockVideo(MockImage):
    kind = 'video'


class Display:
    CATEGORY = 'STRGO/API-only'
    FUNCTION = 'execute'
    RETURN_TYPES = ()
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'value': ('STRING', {'forceInput': True})}}

    def execute(self, value):
        return {'ui': {'text': [value]}, 'result': ()}


NODE_CLASS_MAPPINGS = {'StrgoText': Text, 'StrgoMockImage': MockImage, 'StrgoMockVideo': MockVideo,
                       'StrgoDisplay': Display}
NODE_DISPLAY_NAME_MAPPINGS = {'StrgoText': 'STRGO Text API', 'StrgoMockImage': 'STRGO Mock Image',
                              'StrgoMockVideo': 'STRGO Mock Video', 'StrgoDisplay': 'STRGO Display'}
